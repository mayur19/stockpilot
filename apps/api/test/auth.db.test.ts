import { describe, expect, it } from 'vitest';
import {
  addUser,
  client,
  hasDatabase,
  login,
  PASSWORD,
  registerOrg,
  useTestServer,
} from './helpers.js';

describe.skipIf(!hasDatabase)('auth & sessions (database)', () => {
  const server = useTestServer({ LOGIN_MAX_ATTEMPTS: '3', LOGIN_IP_MAX_ATTEMPTS: '3' });

  it('registers an owner without issuing a session, then signs in with cookies', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        organizationName: 'Acme 3PL',
        name: 'Ada',
        email: 'Ada@Example.test',
        password: PASSWORD,
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.cookies).toHaveLength(0);
    expect(response.json().data.status).toBe('accepted');
    const signIn = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ada@example.test', password: PASSWORD },
    });
    const session = signIn.cookies.find((c) => c.name === 'sp_session');
    const csrf = signIn.cookies.find((c) => c.name === 'sp_csrf');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Lax');
    expect(csrf?.httpOnly).toBeFalsy();
    expect(signIn.json().data.user).toMatchObject({ email: 'ada@example.test', role: 'owner' });
  });

  it('does not reveal whether an email is already registered', async () => {
    const owner = await registerOrg(server.app, 'dup');
    const register = (email: string) =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { organizationName: 'Other', name: 'X', email, password: 'another-long-password' },
      });
    const existing = await register(owner.email);
    const fresh = await register(`fresh-${Date.now()}@example.test`);
    expect(existing.statusCode).toBe(fresh.statusCode);
    expect(existing.json()).toEqual(fresh.json());
    expect(existing.cookies).toEqual(fresh.cookies);
    // The original owner's password is untouched and no second org was created.
    expect(
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '10.0.2.1',
          payload: { email: owner.email, password: 'another-long-password' },
        })
      ).statusCode,
    ).toBe(401);
    const { rows } = await server.db.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE organization_id = $1 AND action = 'auth.register_duplicate'",
      [owner.organizationId],
    );
    expect(rows).toHaveLength(1);
    const weak = await register('weak@example.test').then(() =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          organizationName: 'Other',
          name: 'X',
          email: 'weak2@example.test',
          password: 'short',
        },
      }),
    );
    expect(weak.statusCode).toBe(400);
  });

  it('returns the current user and organisation from /me', async () => {
    const owner = await registerOrg(server.app, 'me');
    const me = await client(server.app, owner).get('/api/v1/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({
      user: { role: 'owner' },
      organization: { name: 'Org me' },
    });
  });

  it('logs in, logs out and invalidates the session server-side', async () => {
    const owner = await registerOrg(server.app, 'logout');
    const session = await login(server.app, owner.email);
    const api = client(server.app, session);
    expect((await api.post('/api/v1/auth/logout')).statusCode).toBe(204);
    expect((await api.get('/api/v1/auth/me')).statusCode).toBe(401);
  });

  it('gives a generic error for bad credentials', async () => {
    const owner = await registerOrg(server.app, 'generic');
    const wrong = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.0.3.1',
      payload: { email: owner.email, password: 'wrong-password-123' },
    });
    const unknown = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.0.3.1',
      payload: { email: 'nobody@example.test', password: 'wrong-password-123' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('locks an account after repeated failures from many IPs (email limiter)', async () => {
    const owner = await registerOrg(server.app, 'email');
    const attempt = (remoteAddress: string, password = 'wrong-password-123') =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress,
        payload: { email: owner.email, password },
      });
    for (let i = 0; i < 3; i += 1) expect((await attempt(`10.0.1.${i}`)).statusCode).toBe(401);
    const blocked = await attempt('10.0.1.200', PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('lets at most N of 20 concurrent bad logins past the throttle', async () => {
    const owner = await registerOrg(server.app, 'burst');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        server.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: `10.30.0.${i}`,
          payload: { email: owner.email, password: 'wrong-password-123' },
        }),
      ),
    );
    const statuses = results.map((r) => r.statusCode);
    // LOGIN_MAX_ATTEMPTS is 3 for this suite: three verifications, the rest throttled.
    expect(statuses.filter((s) => s === 401)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(17);
  });

  it('blocks an IP spraying one password across many accounts (IP limiter)', async () => {
    // Sequential: in-flight logins count against the per-IP limit until they succeed.
    const victims = [];
    for (const i of [1, 2, 3, 4]) victims.push(await registerOrg(server.app, `spray${i}`));
    const spray = (email: string) =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '10.9.9.9',
        payload: { email, password: 'Summer2026!Summer' },
      });
    for (const victim of victims.slice(0, 3))
      expect((await spray(victim.email)).statusCode).toBe(401);
    // Fourth account has zero failures, yet the IP is now throttled.
    expect((await spray((victims[3] as { email: string }).email)).statusCode).toBe(429);
    const otherIp = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.9.9.10',
      payload: { email: (victims[3] as { email: string }).email, password: PASSWORD },
    });
    expect(otherIp.statusCode).toBe(200);
  });

  it('requires the CSRF header on mutating requests', async () => {
    const owner = await registerOrg(server.app, 'csrf');
    const noHeader = await server.app.inject({
      method: 'POST',
      url: '/api/v1/warehouses',
      headers: { cookie: owner.cookie },
      payload: { code: 'X1', name: 'X' },
    });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().error.code).toBe('CSRF_INVALID');
    const wrong = await server.app.inject({
      method: 'POST',
      url: '/api/v1/warehouses',
      headers: { cookie: owner.cookie, 'x-csrf-token': 'forged' },
      payload: { code: 'X1', name: 'X' },
    });
    expect(wrong.statusCode).toBe(403);
  });

  it('enforces RBAC permissions per role', async () => {
    const owner = await registerOrg(server.app, 'rbac');
    const viewer = client(server.app, await addUser(server, owner.organizationId, 'viewer'));
    const operator = client(server.app, await addUser(server, owner.organizationId, 'operator'));
    expect((await viewer.get('/api/v1/warehouses')).statusCode).toBe(200);
    expect((await viewer.post('/api/v1/warehouses', { code: 'V1', name: 'V' })).statusCode).toBe(
      403,
    );
    expect((await operator.post('/api/v1/skus', { code: 'S1', description: 'x' })).statusCode).toBe(
      403,
    );
    expect((await operator.get('/api/v1/inventory/projection/verify')).statusCode).toBe(403);
  });

  it('writes audit events for registration and login', async () => {
    const owner = await registerOrg(server.app, 'audit');
    await login(server.app, owner.email);
    const { rows } = await server.db.query<{ action: string }>(
      'SELECT action FROM audit_events WHERE organization_id = $1 ORDER BY id',
      [owner.organizationId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'organization.registered',
      'auth.login',
      'auth.login',
    ]);
  });

  it('answers 501 with a ticket for pending endpoints once signed in', async () => {
    const owner = await registerOrg(server.app, 'pending');
    const response = await client(server.app, owner).post('/api/v1/waves', {});
    expect(response.statusCode).toBe(501);
    expect(response.json().error).toMatchObject({
      code: 'NOT_IMPLEMENTED',
      details: { ticket: 'SP-092' },
    });
  });

  it('reports readiness with the migration count', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.migrations).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(!hasDatabase)('registration throttling (database)', () => {
  const server = useTestServer({ REGISTER_IP_MAX_ATTEMPTS: '2' });

  it('rate limits registrations per IP', async () => {
    const register = (i: number, remoteAddress = '10.5.5.5') =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress,
        payload: {
          organizationName: 'Org',
          name: 'X',
          email: `reg${i}-${Date.now()}@example.test`,
          password: PASSWORD,
        },
      });
    expect((await register(1)).statusCode).toBe(202);
    expect((await register(2)).statusCode).toBe(202);
    const third = await register(3);
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect((await register(4, '10.5.5.6')).statusCode).toBe(202);
  });
});

describe.skipIf(!hasDatabase)('proxy trust and per-IP throttling (database)', () => {
  const direct = useTestServer({ LOGIN_IP_MAX_ATTEMPTS: '2', LOGIN_MAX_ATTEMPTS: '50' });
  const proxied = useTestServer({
    LOGIN_IP_MAX_ATTEMPTS: '2',
    LOGIN_MAX_ATTEMPTS: '50',
    TRUST_PROXY: '1',
  });

  const fail = (server: typeof direct, forwardedFor: string) =>
    server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.20.0.1',
      headers: { 'x-forwarded-for': forwardedFor },
      payload: { email: `nobody-${forwardedFor}@example.test`, password: 'wrong-password-123' },
    });

  it('cannot evade the IP limiter by rotating X-Forwarded-For when no proxy is trusted', async () => {
    expect((await fail(direct, '198.51.100.1')).statusCode).toBe(401);
    expect((await fail(direct, '198.51.100.2')).statusCode).toBe(401);
    expect((await fail(direct, '198.51.100.3')).statusCode).toBe(429);
  });

  it('uses the forwarded client address when one proxy hop is trusted', async () => {
    expect((await fail(proxied, '198.51.100.1')).statusCode).toBe(401);
    expect((await fail(proxied, '198.51.100.1')).statusCode).toBe(401);
    expect((await fail(proxied, '198.51.100.1')).statusCode).toBe(429);
    expect((await fail(proxied, '198.51.100.2')).statusCode).toBe(401);
  });
});
