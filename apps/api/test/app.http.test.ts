import { describe, expect, it } from 'vitest';
import { PENDING_ENDPOINTS } from '../src/modules/pending/pending.catalog.js';
import { useTestServer } from './helpers.js';

describe('HTTP shell (no session)', () => {
  const server = useTestServer();

  it('serves health with security headers and a request id', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { status: 'ok' }, error: null });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('echoes a well-formed incoming request id and replaces a malformed one', async () => {
    const good = await server.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(good.headers['x-request-id']).toBe('req-12345678');
    const bad = await server.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(bad.headers['x-request-id']).not.toBe('bad id!');
  });

  it('returns the envelope for unknown routes', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects protected routes without a session', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/v1/warehouses' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      data: null,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });

  it('validates login bodies before touching the database', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nope' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects malformed JSON with a 400 envelope', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('registers every pending endpoint behind authentication', async () => {
    for (const endpoint of PENDING_ENDPOINTS) {
      const url = endpoint.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
      const response = await server.app.inject({ method: endpoint.method, url });
      expect(response.statusCode, `${endpoint.method} ${endpoint.path}`).toBe(401);
    }
  });

  it('every pending ticket follows the SP-### format', () => {
    for (const endpoint of PENDING_ENDPOINTS) expect(endpoint.ticket).toMatch(/^SP-\d{3}$/);
  });
});

describe('trust proxy', () => {
  it('maps config to fastify options without ever trusting everyone', async () => {
    const { trustProxyOption } = await import('../src/app.js');
    expect(trustProxyOption(false)).toBe(false);
    expect(trustProxyOption(['10.0.0.0/8'])).toEqual(['10.0.0.0/8']);
    const hops = trustProxyOption(1) as (a: string, h: number) => boolean;
    expect(hops('10.0.0.1', 0)).toBe(true);
    expect(hops('10.0.0.2', 1)).toBe(false);
  });
});
