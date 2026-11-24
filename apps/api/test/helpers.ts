import { randomUUID } from 'node:crypto';
import type { Role } from '@stockpilot/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';
import type { AppContext } from '../src/context.js';
import { createPool, type Db } from '../src/db/pool.js';
import { createAuthThrottle } from '../src/http/rate-limiter.js';
import { insertUser } from '../src/modules/auth/auth.repository.js';
import { hashPassword } from '../src/modules/auth/password.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDatabase = Boolean(TEST_DATABASE_URL);
export const PASSWORD = 'correct-horse-battery-staple';

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL ?? 'postgresql://127.0.0.1:1/none',
    SESSION_SECRET: 'test-secret-'.padEnd(48, 'x'),
    LOG_LEVEL: 'silent',
    REGISTER_IP_MAX_ATTEMPTS: '1000',
    LOGIN_IP_MAX_ATTEMPTS: '1000',
    LOGIN_IP_MAX_EMAILS: '1000',
    ...overrides,
  });
}

export interface TestServer {
  app: FastifyInstance;
  db: Db;
  ctx: AppContext;
}

/** Builds an app wired to the test database and closes it after the suite. */
export function useTestServer(overrides: Partial<Record<keyof Env, string>> = {}): TestServer {
  const server = {} as TestServer;
  beforeAll(async () => {
    const env = testEnv(overrides);
    const db = createPool({ DATABASE_URL: env.DATABASE_URL, DATABASE_POOL_MAX: 20 });
    const ctx: AppContext = {
      env,
      db,
      throttle: createAuthThrottle(env),
    };
    server.ctx = ctx;
    server.db = db;
    server.app = buildApp(ctx);
    await server.app.ready();
  });
  afterAll(async () => {
    await server.app.close();
    await server.db.end();
  });
  return server;
}

export interface Session {
  cookie: string;
  csrf: string;
  organizationId: string;
  userId: string;
}

function cookieHeader(response: LightMyRequestResponse): string {
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export async function registerOrg(
  app: FastifyInstance,
  label = 'org',
): Promise<Session & { email: string }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: `Org ${label}`, name: 'Owner', email, password: PASSWORD },
  });
  if (response.statusCode !== 202) throw new Error(`register failed: ${response.body}`);
  return { email, ...(await login(app, email)) };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
  const body = response.json();
  return {
    cookie: cookieHeader(response),
    csrf: body.data.csrfToken,
    organizationId: body.data.user.organizationId,
    userId: body.data.user.id,
  };
}

export async function addUser(
  server: TestServer,
  organizationId: string,
  role: Role,
): Promise<Session> {
  const email = `${role}-${randomUUID().slice(0, 8)}@example.test`;
  await insertUser(server.db, {
    organizationId,
    email,
    name: role,
    passwordHash: await hashPassword(PASSWORD),
    role,
  });
  return login(server.app, email);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export function client(app: FastifyInstance, session: Session) {
  const call = (method: Method, url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: unknown) => call('POST', url, payload ?? {}),
    call,
  };
}

export type Client = ReturnType<typeof client>;

/** Creates a warehouse with storage, pick, receiving and quarantine zones. */
export async function buildWarehouse(api: Client) {
  const warehouse = (
    await api.post('/api/v1/warehouses', {
      code: `WH${randomUUID().slice(0, 4)}`,
      name: 'Test DC',
      timezone: 'UTC',
    })
  ).json().data;
  const zone = async (code: string, zoneType: string) =>
    (
      await api.post(`/api/v1/warehouses/${warehouse.id}/zones`, { code, name: code, zoneType })
    ).json().data;
  const storage = await zone('A', 'STORAGE');
  const pick = await zone('P', 'PICK');
  const receiving = await zone('RCV', 'RECEIVING');
  const quarantine = await zone('Q', 'QUARANTINE');
  const bin = async (zoneId: string, code: string) =>
    (await api.post(`/api/v1/warehouses/${warehouse.id}/bins`, { zoneId, code })).json().data;
  return {
    warehouse,
    bins: {
      a1: await bin(storage.id, 'A-01-01-1-A'),
      a2: await bin(storage.id, 'A-01-02-1-A'),
      a3: await bin(storage.id, 'A-02-01-1-A'),
      p1: await bin(pick.id, 'P-01-01-0-A'),
      rcv: await bin(receiving.id, 'RCV01'),
      q: await bin(quarantine.id, 'QCAGE'),
    },
  };
}

export async function createSku(api: Client, overrides: Record<string, unknown> = {}) {
  const response = await api.post('/api/v1/skus', {
    code: `SKU-${randomUUID().slice(0, 6)}`,
    description: 'Test item',
    uomLevels: [
      { code: 'CS', factor: 12 },
      { code: 'PL', factor: 480 },
    ],
    lotTracked: true,
    expiryTracked: true,
    defaultStrategy: 'FEFO',
    ...overrides,
  });
  if (response.statusCode !== 201) throw new Error(`sku failed: ${response.body}`);
  return response.json().data;
}

export function isoDaysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
