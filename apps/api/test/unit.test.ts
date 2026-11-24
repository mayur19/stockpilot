import { DomainError } from '@stockpilot/shared';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { AppError, fromDomainError, fromPgError } from '../src/http/errors.js';
import {
  createAuthThrottle,
  createBackoffLimiter,
  createWindowLimiter,
  ipv6Prefix48,
  normaliseIp,
  PREFIX48_EMAIL_MULTIPLIER,
} from '../src/http/rate-limiter.js';
import { createFailureSketch, SATURATION_THRESHOLD } from '../src/http/count-min-sketch.js';
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
        TRUST_PROXY: 'false',
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

  it('requires an explicit TRUST_PROXY in production and never derives it from NODE_ENV', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(
      /TRUST_PROXY must be set/,
    );
    expect(loadEnv({ ...baseEnv, NODE_ENV: 'production', TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(
      false,
    );
    expect(loadEnv({ ...baseEnv, NODE_ENV: 'production', TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
  });
});

describe('auth throttle', () => {
  const config = {
    LOGIN_MAX_ATTEMPTS: 3,
    LOGIN_WINDOW_MINUTES: 15,
    LOGIN_BACKOFF_BASE_SECONDS: 30,
    LOGIN_IP_MAX_ATTEMPTS: 5,
    LOGIN_IP_MAX_EMAILS: 100,
    REGISTER_IP_MAX_ATTEMPTS: 2,
    SESSION_SECRET: 'unit-test-secret'.padEnd(40, 'x'),
  };

  it('reserves attempts synchronously: a burst lets exactly N through', () => {
    const throttle = createAuthThrottle(
      { ...config, LOGIN_IP_MAX_ATTEMPTS: 1000 },
      { now: () => 0 },
    );
    const passed = Array.from({ length: 20 }, (_, i) =>
      throttle.reserveLogin(`ip${i}`, 'a@x'),
    ).filter((wait) => wait === 0);
    expect(passed).toHaveLength(3);
  });

  it('applies progressive backoff per email regardless of IP', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, { now: () => now });
    for (let i = 0; i < 3; i += 1) expect(throttle.reserveLogin(`10.0.0.${i}`, 'a@x')).toBe(0);
    expect(throttle.reserveLogin('10.0.0.9', 'a@x')).toBe(30_000);
    now = 30_000;
    expect(throttle.reserveLogin('10.0.0.9', 'a@x')).toBe(0);
    expect(throttle.reserveLogin('10.0.0.8', 'a@x')).toBe(60_000);
    now = 90_000;
    expect(throttle.reserveLogin('10.0.0.8', 'a@x')).toBe(0);
    expect(throttle.reserveLogin('10.0.0.7', 'a@x')).toBe(120_000);
    throttle.recordLoginSuccess('10.0.0.8', 'a@x');
    expect(throttle.reserveLogin('10.0.0.7', 'a@x')).toBe(0);
  });

  it('caps the backoff at the login window', () => {
    let now = 0;
    const throttle = createAuthThrottle(
      { ...config, LOGIN_IP_MAX_ATTEMPTS: 1000 },
      { now: () => now },
    );
    for (let i = 0; i < 40; i += 1) {
      const wait = throttle.reserveLogin(`10.1.0.${i}`, 'b@x');
      expect(wait).toBeLessThanOrEqual(15 * 60_000);
      now += wait;
    }
  });

  it('throttles an IP spraying many accounts; success frees only its own slot', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, { now: () => now });
    for (let i = 0; i < 5; i += 1) expect(throttle.reserveLogin('1.2.3.4', `user${i}@x`)).toBe(0);
    expect(throttle.reserveLogin('1.2.3.4', 'fresh@x')).toBeGreaterThan(0);
    expect(throttle.reserveLogin('5.6.7.8', 'fresh@x')).toBe(0);
    throttle.recordLoginSuccess('1.2.3.4', 'user0@x');
    expect(throttle.reserveLogin('1.2.3.4', 'fresh@x')).toBe(0);
    expect(throttle.reserveLogin('1.2.3.4', 'other@x')).toBeGreaterThan(0);
    now = 15 * 60_000;
    expect(throttle.reserveLogin('1.2.3.4', 'other@x')).toBe(0);
  });

  it('caps distinct emails per normalised IP per window', () => {
    const throttle = createAuthThrottle(
      { ...config, LOGIN_IP_MAX_ATTEMPTS: 1000, LOGIN_IP_MAX_EMAILS: 3 },
      { now: () => 0 },
    );
    for (let i = 0; i < 3; i += 1)
      expect(throttle.reserveLogin('2001:db8:1:2::5', `e${i}@x`)).toBe(0);
    expect(throttle.reserveLogin('2001:db8:1:2::99', 'e9@x')).toBeGreaterThan(0);
    expect(throttle.reserveLogin('2001:db8:1:2::99', 'e1@x')).toBe(0);
  });

  it('limits registrations per IP per hour', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, { now: () => now });
    expect(throttle.reserveRegistration('::ffff:9.9.9.9')).toBe(0);
    expect(throttle.reserveRegistration('9.9.9.9')).toBe(0);
    expect(throttle.reserveRegistration('9.9.9.9')).toBe(3_600_000);
    now = 3_600_000;
    expect(throttle.reserveRegistration('9.9.9.9')).toBe(0);
  });

  it('never locks out new keys when the store is full; evicts least time left with a warning', () => {
    let now = 0;
    const warnings: string[] = [];
    const limiter = createBackoffLimiter(
      {
        freeAttempts: 1,
        baseDelayMs: 1000,
        maxDelayMs: 100_000,
        decayMs: 1000,
        capacity: 3,
        onWarning: (event) => warnings.push(event),
      },
      () => now,
    );
    for (const key of ['a', 'b', 'c']) {
      limiter.reserve(key);
      now += 10;
    }
    // All three are active (locked out); a new key still gets in immediately.
    expect(limiter.reserve('d')).toBe(0);
    expect(limiter.size()).toBe(3);
    expect(warnings).toEqual(['throttle_store_full']);
    // The entry with the least time left ('a', oldest) was evicted; others kept their lock.
    expect(limiter.retryAfterMs('a')).toBe(0);
    expect(limiter.retryAfterMs('c')).toBeGreaterThan(0);
  });

  it('sweeps lapsed entries before evicting anything', () => {
    let now = 0;
    const warnings: string[] = [];
    const limiter = createWindowLimiter(
      1,
      1000,
      () => now,
      2,
      (event) => warnings.push(event),
    );
    limiter.reserve('old');
    now = 900;
    limiter.reserve('young');
    now = 1000;
    expect(limiter.reserve('new')).toBe(0);
    expect(warnings).toEqual([]);
    expect(limiter.retryAfterMs('young')).toBeGreaterThan(0);
  });

  it('forgets stale failures after the decay period and supports release/reset', () => {
    let now = 0;
    const limiter = createBackoffLimiter(
      { freeAttempts: 1, baseDelayMs: 10, maxDelayMs: 100, decayMs: 1000 },
      () => now,
    );
    limiter.reserve('k');
    expect(limiter.retryAfterMs('k')).toBe(10);
    now = 1000;
    expect(limiter.retryAfterMs('k')).toBe(0);
    limiter.reserve('k');
    limiter.reserve('k');
    limiter.release('k');
    limiter.release('k');
    limiter.release('missing');
    expect(limiter.size()).toBe(0);
    limiter.reserve('k');
    limiter.reset('k');
    expect(limiter.retryAfterMs('k')).toBe(0);
  });
});

describe('lock-outs survive cache eviction (count-min sketch)', () => {
  const config = {
    LOGIN_MAX_ATTEMPTS: 3,
    LOGIN_WINDOW_MINUTES: 15,
    LOGIN_BACKOFF_BASE_SECONDS: 30,
    LOGIN_IP_MAX_ATTEMPTS: 1_000_000,
    LOGIN_IP_MAX_EMAILS: 1_000_000,
    REGISTER_IP_MAX_ATTEMPTS: 2,
    SESSION_SECRET: 'sketch-test-secret'.padEnd(40, 'x'),
  };

  it('an evicted active lock-out is still enforced after a flood', () => {
    const now = 0;
    const warnings: string[] = [];
    const throttle = createAuthThrottle(config, {
      now: () => now,
      capacity: 50,
      onWarning: (event) => warnings.push(event),
    });
    for (let i = 0; i < 3; i += 1) throttle.reserveLogin(`10.0.0.${i}`, 'victim@x');
    expect(throttle.reserveLogin('10.0.0.9', 'victim@x')).toBeGreaterThan(0);
    // Flood: locked-out keys (4 failures each) push the victim out of the cache.
    for (let i = 0; i < 300; i += 1) {
      for (let f = 0; f < 4; f += 1)
        throttle.reserveLogin(`172.16.${i >> 8}.${i & 255}`, `flood${i}@x`);
    }
    expect(warnings).toContain('throttle_store_full');
    expect(throttle.reserveLogin('10.0.0.9', 'victim@x')).toBeGreaterThan(0);
  });

  it('failures spread across many emails never lock out an untouched email', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, { now: () => now, capacity: 50 });
    for (let i = 0; i < 5_000; i += 1) {
      throttle.reserveLogin(`172.17.${i >> 8}.${i & 255}`, `spread${i}@x`);
      now += 1;
    }
    let blocked = 0;
    for (let i = 0; i < 500; i += 1) {
      if (throttle.reserveLogin(`192.168.${i >> 8}.${i & 255}`, `untouched-${i}@example.test`) > 0)
        blocked += 1;
    }
    expect(blocked).toBe(0);
  });

  it('a successful login clears the lock-out, even after an earlier eviction', () => {
    let now = 0;
    const throttle = createAuthThrottle(config, { now: () => now, capacity: 10 });
    for (let i = 0; i < 2; i += 1) throttle.reserveLogin('10.1.1.1', 'user@x');
    for (let i = 0; i < 20; i += 1) {
      for (let f = 0; f < 4; f += 1) throttle.reserveLogin('10.2.2.2', `noise${i}@x`);
    }
    throttle.reserveLogin('10.1.1.1', 'user@x');
    throttle.recordLoginSuccess('10.1.1.1', 'user@x');
    expect(throttle.reserveLogin('10.1.1.1', 'user@x')).toBe(0);
    now += 1;
    expect(throttle.reserveLogin('10.1.1.1', 'user@x')).toBe(0);
  });

  it('caps new emails per IPv6 /48 across rotating /64s', () => {
    const throttle = createAuthThrottle({ ...config, LOGIN_IP_MAX_EMAILS: 2 }, { now: () => 0 });
    let admitted = 0;
    for (let subnet = 0; subnet < 10; subnet += 1) {
      for (let e = 0; e < 2; e += 1) {
        if (
          throttle.reserveLogin(`2001:db8:aa:${subnet.toString(16)}::1`, `s${subnet}e${e}@x`) === 0
        )
          admitted += 1;
      }
    }
    expect(admitted).toBe(2 * PREFIX48_EMAIL_MULTIPLIER);
    expect(ipv6Prefix48('2001:db8:aa:5::/64')).toBe('2001:db8:aa::/48');
    expect(ipv6Prefix48('10.0.0.1')).toBeNull();
  });
});

describe('failure sketch', () => {
  it('returns what was absorbed, decays after two generations, ignores unknown keys', () => {
    let now = 1000;
    const sketch = createFailureSketch({ secret: 's', generationMs: 100, now: () => now });
    sketch.absorb('k', 5, 990);
    expect(sketch.estimate('k')).toEqual({ count: 5, lastAt: 990 });
    expect(sketch.estimate('other')).toBeNull();
    now += 100;
    expect(sketch.estimate('k')?.count).toBe(5);
    now += 100;
    expect(sketch.estimate('k')).toBeNull();
    now += 250;
    sketch.absorb('k', 1, now);
    expect(sketch.estimate('k')?.count).toBe(1);
  });

  it('is ignored with an alert and a counter once a row is over half full', () => {
    const alerts: string[] = [];
    const sketch = createFailureSketch({
      secret: 's',
      generationMs: 1_000_000,
      depth: 2,
      width: 16,
      now: () => 0,
      onAlert: (event) => alerts.push(event),
    });
    sketch.absorb('victim', 9, 0);
    expect(sketch.estimate('victim')?.count).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < 64; i += 1) sketch.absorb(`fill${i}`, 1, 0);
    expect(sketch.estimate('victim')).toBeNull();
    expect(alerts).toContain('throttle_sketch_saturated');
    expect(sketch.stats().saturatedReads).toBe(1);
    expect(sketch.stats().maxRowOccupancy).toBeGreaterThan(SATURATION_THRESHOLD);
  });

  it('rejects invalid dimensions', () => {
    expect(() => createFailureSketch({ secret: 's', generationMs: 1, depth: 0 })).toThrow();
  });
});

describe('normaliseIp', () => {
  it('collapses mapped IPv4 and reduces IPv6 to /64', () => {
    expect(normaliseIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normaliseIp(' 10.0.0.1 ')).toBe('10.0.0.1');
    expect(normaliseIp('2001:DB8:0001:0002:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(normaliseIp('2001:db8:1:2::ffff')).toBe('2001:db8:1:2::/64');
    expect(normaliseIp('::1')).toBe('0:0:0:0::/64');
    expect(normaliseIp('')).toBe('unknown');
    expect(normaliseIp(null)).toBe('unknown');
  });
});

describe('canonicalTimezone', () => {
  it('canonicalises case and rejects unknown zones', () => {
    expect(canonicalTimezone('europe/london')).toBe('Europe/London');
    expect(canonicalTimezone('UTC')).toBe('UTC');
    expect(canonicalTimezone('Mars/Olympus')).toBeNull();
  });
});
