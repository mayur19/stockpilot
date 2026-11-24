import { DomainError } from '@stockpilot/shared';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { AppError, fromDomainError, fromPgError } from '../src/http/errors.js';
import {
  createAuthThrottle,
  createBackoffLimiter,
  createWindowLimiter,
} from '../src/http/rate-limiter.js';
import { canonicalTimezone } from '../src/modules/topology/topology.routes.js';
import { parse } from '../src/http/validate.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { randomToken, safeEqual, sessionIdFor } from '../src/modules/auth/tokens.js';
import { todayIn } from '../src/modules/inventory/inventory.service.js';
import { z } from 'zod';

const baseEnv = { DATABASE_URL: 'postgresql://localhost/x', SESSION_SECRET: 'a'.repeat(40) };

describe('loadEnv', () => {
  it('applies defaults for the stockpilot ports', () => {
    const env = loadEnv(baseEnv);
    expect(env.API_PORT).toBe(4103);
    expect(env.APP_ORIGIN).toBe('http://localhost:5103');
    expect(env.SESSION_TTL_HOURS).toBe(12);
  });

  it('fails fast with a readable message', () => {
    expect(() => loadEnv({ DATABASE_URL: '' })).toThrow(
      /DATABASE_URL.*SESSION_SECRET|SESSION_SECRET/,
    );
    expect(() => loadEnv({ ...baseEnv, API_PORT: '99999' })).toThrow(/API_PORT/);
  });

  it('refuses the placeholder secret in production', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        SESSION_SECRET: 'replace-me-with-a-long-random-local-only-value',
      }),
    ).toThrow(/placeholder/);
  });
});

describe('passwords and tokens', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('a long enough password');
    const b = await hashPassword('a long enough password');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('a long enough password', a)).toBe(true);
    expect(await verifyPassword('wrong password here', a)).toBe(false);
    expect(await verifyPassword('anything', 'md5$abc')).toBe(false);
    expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false);
  });

  it('derives stable session ids and compares safely', () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(sessionIdFor(token, 's1')).toBe(sessionIdFor(token, 's1'));
    expect(sessionIdFor(token, 's1')).not.toBe(sessionIdFor(token, 's2'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('error mapping', () => {
  it('maps domain errors to statuses', () => {
    expect(fromDomainError(new DomainError('INSUFFICIENT_AVAILABLE', 'x')).status).toBe(409);
    expect(fromDomainError(new DomainError('INVALID_UOM', 'x')).status).toBe(400);
  });

  it('maps postgres constraint errors', () => {
    expect(fromPgError({ code: '23505', constraint: 'k' })?.code).toBe('ALREADY_EXISTS');
    expect(fromPgError({ code: '23514' })?.status).toBe(409);
    expect(fromPgError({ code: '23503' })?.status).toBe(400);
    expect(fromPgError({ code: '40P01' })?.status).toBe(503);
    expect(fromPgError({ code: '42601' })).toBeNull();
  });

  it('parse throws a 400 AppError with issue paths', () => {
    try {
      parse(z.object({ n: z.number() }), { n: 'x' });
      expect.fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toEqual([{ path: 'n', message: expect.any(String) }]);
    }
  });
});

describe('todayIn', () => {
  it('computes the local calendar date for a warehouse time zone', () => {
    const instant = new Date('2026-03-01T23:30:00Z');
    expect(todayIn('UTC', instant)).toBe('2026-03-01');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-03-02');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-03-01');
  });
});

describe('TRUST_PROXY', () => {
  it('defaults to false and accepts hop counts and proxy lists', () => {
    expect(loadEnv(baseEnv).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...baseEnv, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...baseEnv, TRUST_PROXY: '127.0.0.1, 10.0.0.0/8' }).TRUST_PROXY).toEqual([
      '127.0.0.1',
      '10.0.0.0/8',
    ]);
    expect(loadEnv({ ...baseEnv, TRUST_PROXY: '::1' }).TRUST_PROXY).toEqual(['::1']);
  });

  it('rejects blanket trust and garbage', () => {
    expect(() => loadEnv({ ...baseEnv, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadEnv({ ...baseEnv, TRUST_PROXY: 'everyone' })).toThrow(/TRUST_PROXY/);
  });

  it('does not derive proxy trust from NODE_ENV', () => {
    expect(loadEnv({ ...baseEnv, NODE_ENV: 'production' }).TRUST_PROXY).toBe(false);
  });
});

describe('auth throttle', () => {
  const config = {
    LOGIN_MAX_ATTEMPTS: 3,
    LOGIN_WINDOW_MINUTES: 15,
    LOGIN_BACKOFF_BASE_SECONDS: 30,
    LOGIN_IP_MAX_ATTEMPTS: 5,
    REGISTER_IP_MAX_ATTEMPTS: 2,
  };

  it('applies progressive backoff per email regardless of IP', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, () => now);
    for (let i = 0; i < 2; i += 1) throttle.recordLoginFailure(`ip${i}`, 'a@x');
    expect(throttle.loginRetryAfterMs('ip9', 'a@x')).toBe(0);
    throttle.recordLoginFailure('ip2', 'a@x');
    expect(throttle.loginRetryAfterMs('ip9', 'a@x')).toBe(30_000);
    now = 30_000;
    expect(throttle.loginRetryAfterMs('ip9', 'a@x')).toBe(0);
    throttle.recordLoginFailure('ip3', 'a@x');
    expect(throttle.loginRetryAfterMs('ip9', 'a@x')).toBe(60_000);
    now = 60_000;
    throttle.recordLoginFailure('ip4', 'a@x');
    expect(throttle.loginRetryAfterMs('ip9', 'a@x')).toBe(120_000);
    throttle.recordLoginSuccess('a@x');
    expect(throttle.loginRetryAfterMs('ip9', 'a@x')).toBe(0);
  });

  it('caps the backoff at the login window', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, () => now);
    for (let i = 0; i < 30; i += 1) {
      throttle.recordLoginFailure(`ip${i}`, 'b@x');
      now += 1;
    }
    expect(throttle.loginRetryAfterMs('ipZ', 'b@x')).toBeLessThanOrEqual(15 * 60_000);
  });

  it('throttles an IP spraying many accounts and keeps it after a success', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, () => now);
    for (let i = 0; i < 5; i += 1) throttle.recordLoginFailure('1.2.3.4', `user${i}@x`);
    expect(throttle.loginRetryAfterMs('1.2.3.4', 'fresh@x')).toBeGreaterThan(0);
    throttle.recordLoginSuccess('fresh@x');
    expect(throttle.loginRetryAfterMs('1.2.3.4', 'fresh@x')).toBeGreaterThan(0);
    expect(throttle.loginRetryAfterMs('5.6.7.8', 'fresh@x')).toBe(0);
    now = 15 * 60_000;
    expect(throttle.loginRetryAfterMs('1.2.3.4', 'fresh@x')).toBe(0);
  });

  it('limits registrations per IP per hour', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, () => now);
    throttle.recordRegistration('ip');
    throttle.recordRegistration('ip');
    expect(throttle.registerRetryAfterMs('ip')).toBe(3_600_000);
    now = 3_600_000;
    expect(throttle.registerRetryAfterMs('ip')).toBe(0);
  });

  it('forgets stale email failures after the decay period', () => {
    let now = 0;
    const limiter = createBackoffLimiter(
      { freeAttempts: 1, baseDelayMs: 10, maxDelayMs: 100, decayMs: 1000 },
      () => now,
    );
    limiter.hit('k');
    expect(limiter.retryAfterMs('k')).toBe(10);
    now = 1000;
    expect(limiter.retryAfterMs('k')).toBe(0);
    limiter.hit('k');
    limiter.reset('k');
    expect(limiter.retryAfterMs('k')).toBe(0);
  });

  it('window limiter resets', () => {
    const limiter = createWindowLimiter(1, 1000, () => 0);
    limiter.hit('k');
    expect(limiter.retryAfterMs('k')).toBe(1000);
    limiter.reset('k');
    expect(limiter.retryAfterMs('k')).toBe(0);
  });
});

describe('canonicalTimezone', () => {
  it('canonicalises case and rejects unknown zones', () => {
    expect(canonicalTimezone('europe/london')).toBe('Europe/London');
    expect(canonicalTimezone('UTC')).toBe('UTC');
    expect(canonicalTimezone('Mars/Olympus')).toBeNull();
  });
});
