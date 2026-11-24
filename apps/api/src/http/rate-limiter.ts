/**
 * In-memory authentication throttles (ADR-0006, docs/security/threat-model.md).
 *
 * Three independent counters protect the login and registration endpoints:
 *  - per-email progressive backoff: after `freeAttempts` failures each further
 *    failure doubles the lock-out (base, 2x, 4x ... capped), defeating targeted
 *    guessing against one account from many IPs;
 *  - per-IP fixed window over *all* emails: catches password spraying (one
 *    password tried against many accounts) that a per-account counter never sees;
 *  - per-IP fixed window for registration attempts.
 *
 * Counters live in process memory, which is correct for the single-instance
 * deployment in docs/operations/deployment.md. They must move to Postgres
 * (SP-183) before more than one API instance runs behind the proxy.
 */
export type Clock = () => number;

export interface WindowLimiter {
  /** Milliseconds until the key may try again, or 0 when allowed. */
  retryAfterMs(key: string): number;
  hit(key: string): void;
  reset(key: string): void;
}

export function createWindowLimiter(
  max: number,
  windowMs: number,
  now: Clock = Date.now,
): WindowLimiter {
  const windows = new Map<string, { count: number; startedAt: number }>();
  const current = (key: string) => {
    const entry = windows.get(key);
    return entry && now() - entry.startedAt < windowMs ? entry : undefined;
  };
  return {
    retryAfterMs: (key) => {
      const entry = current(key);
      return entry && entry.count >= max ? entry.startedAt + windowMs - now() : 0;
    },
    hit: (key) => {
      const entry = current(key);
      windows.set(
        key,
        entry
          ? { count: entry.count + 1, startedAt: entry.startedAt }
          : { count: 1, startedAt: now() },
      );
    },
    reset: (key) => {
      windows.delete(key);
    },
  };
}

export interface BackoffOptions {
  readonly freeAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Failures older than this are forgotten. */
  readonly decayMs: number;
}

export function createBackoffLimiter(
  options: BackoffOptions,
  now: Clock = Date.now,
): WindowLimiter {
  const failures = new Map<string, { count: number; lastAt: number }>();
  const current = (key: string) => {
    const entry = failures.get(key);
    return entry && now() - entry.lastAt < options.decayMs ? entry : undefined;
  };
  const delayFor = (count: number): number => {
    if (count < options.freeAttempts) return 0;
    const exponent = Math.min(count - options.freeAttempts, 20);
    return Math.min(options.baseDelayMs * 2 ** exponent, options.maxDelayMs);
  };
  return {
    retryAfterMs: (key) => {
      const entry = current(key);
      if (!entry) return 0;
      return Math.max(0, entry.lastAt + delayFor(entry.count) - now());
    },
    hit: (key) => {
      const entry = current(key);
      failures.set(key, { count: (entry?.count ?? 0) + 1, lastAt: now() });
    },
    reset: (key) => {
      failures.delete(key);
    },
  };
}

export interface AuthThrottle {
  /** Milliseconds to wait before another login attempt for this IP/email, 0 if allowed. */
  loginRetryAfterMs(ip: string, email: string): number;
  recordLoginFailure(ip: string, email: string): void;
  /** Clears the per-email backoff; the per-IP spraying window is deliberately kept. */
  recordLoginSuccess(email: string): void;
  registerRetryAfterMs(ip: string): number;
  recordRegistration(ip: string): void;
}

export interface AuthThrottleConfig {
  readonly LOGIN_MAX_ATTEMPTS: number;
  readonly LOGIN_WINDOW_MINUTES: number;
  readonly LOGIN_BACKOFF_BASE_SECONDS: number;
  readonly LOGIN_IP_MAX_ATTEMPTS: number;
  readonly REGISTER_IP_MAX_ATTEMPTS: number;
}

export function createAuthThrottle(
  config: AuthThrottleConfig,
  now: Clock = Date.now,
): AuthThrottle {
  const windowMs = config.LOGIN_WINDOW_MINUTES * 60_000;
  const byEmail = createBackoffLimiter(
    {
      freeAttempts: config.LOGIN_MAX_ATTEMPTS,
      baseDelayMs: config.LOGIN_BACKOFF_BASE_SECONDS * 1000,
      maxDelayMs: windowMs,
      decayMs: windowMs * 4,
    },
    now,
  );
  const byIp = createWindowLimiter(config.LOGIN_IP_MAX_ATTEMPTS, windowMs, now);
  const registrations = createWindowLimiter(config.REGISTER_IP_MAX_ATTEMPTS, 60 * 60_000, now);
  return {
    loginRetryAfterMs: (ip, email) => Math.max(byEmail.retryAfterMs(email), byIp.retryAfterMs(ip)),
    recordLoginFailure: (ip, email) => {
      byEmail.hit(email);
      byIp.hit(ip);
    },
    recordLoginSuccess: (email) => byEmail.reset(email),
    registerRetryAfterMs: (ip) => registrations.retryAfterMs(ip),
    recordRegistration: (ip) => registrations.hit(ip),
  };
}
