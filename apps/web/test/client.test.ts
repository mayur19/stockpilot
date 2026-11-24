import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiRequest, errorMessage, readCsrfToken } from '../src/api/client';

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'sp_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

function mockFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

describe('readCsrfToken', () => {
  it('extracts the csrf cookie among others', () => {
    expect(readCsrfToken('a=1; sp_csrf=abc%3D; b=2')).toBe('abc=');
    expect(readCsrfToken('a=1')).toBeNull();
  });
});

describe('apiRequest', () => {
  it('unwraps data and sends the csrf header on mutations', async () => {
    document.cookie = 'sp_csrf=token123';
    const spy = mockFetch(200, { data: { ok: true }, error: null });
    await expect(apiRequest('POST', '/api/v1/x', { a: 1 })).resolves.toEqual({ ok: true });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('token123');
    expect(init.body).toBe('{"a":1}');
  });

  it('does not send csrf on GET', async () => {
    document.cookie = 'sp_csrf=token123';
    const spy = mockFetch(200, { data: [], error: null });
    await apiRequest('GET', '/api/v1/x');
    expect((spy.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty('x-csrf-token');
  });

  it('throws ApiRequestError with the envelope code', async () => {
    mockFetch(409, { data: null, error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough' } });
    const error = await apiRequest('POST', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe('INSUFFICIENT_STOCK');
    expect((error as ApiRequestError).status).toBe(409);
  });

  it('handles 204 and non-JSON failures', async () => {
    mockFetch(204, undefined);
    await expect(apiRequest('POST', '/x')).resolves.toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('oops', { status: 502 }));
    await expect(apiRequest('GET', '/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('errorMessage', () => {
  it('includes the first validation issue', () => {
    const error = new ApiRequestError(400, {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: [{ path: 'quantity', message: 'Expected number' }],
    });
    expect(errorMessage(error)).toBe('Request validation failed: quantity Expected number');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('x')).toBe('Something went wrong');
  });
});
