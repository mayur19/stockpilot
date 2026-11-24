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
 * Attempts are *reserved* synchronously (check + count in one step, before any
 * await), so a burst of concurrent requests cannot all pass the check before the
 * first failure is recorded. A successful login gives its reservation back.
 *
 * Stores are bounded. When a store is full, a resumable cursor sweeps lapsed
 * entries across the whole map; only if every entry is still active is the entry
 * with the least time left evicted (and a warning emitted). New keys are never
 * refused just because the store is full, so filling it cannot lock users out.
 * Each normalised IP may also introduce only a limited number of distinct emails
 * per window, which bounds how fast one client can grow the per-email store.
 *
 * Counters live in process memory, which is correct for the single-instance
 * deployment in docs/operations/deployment.md. They must move to Postgres
 * (SP-183) before more than one API instance runs behind the proxy.
 */
export type Clock = () => number;
export type WarningSink = (event: string, detail: Record<string, unknown>) => void;

export const DEFAULT_STORE_CAPACITY = 100_000;
const SWEEP_BUDGET = 1_000;

export interface Limiter {
  /** Milliseconds until the key may try again, or 0 when allowed. */
  retryAfterMs(key: string): number;
  /** Atomically checks and counts an attempt; returns 0 when the attempt was reserved. */
  reserve(key: string): number;
  /** Gives back one previously reserved attempt (e.g. after a successful login). */
  release(key: string): void;
  reset(key: string): void;
  size(): number;
}

interface Entry {
  count: number;
  startedAt: number;
  lastAt: number;
}

interface StoreRules {
  readonly name: string;
  readonly capacity: number;
  /** Remaining wait for a key, given its entry (<= 0 means allowed). */
  readonly waitFor: (entry: Entry, now: number) => number;
  /** Remaining lifetime of an entry; it is stale (droppable) once this is <= 0. */
  readonly lifetimeLeft: (entry: Entry, now: number) => number;
  readonly onWarning?: WarningSink | undefined;
}

/**
 * Bounded key -> entry store with a resumable sweep cursor. Map iteration order is
 * insertion order, and deleting during iteration is safe, so the cursor resumes
 * where the previous sweep stopped and eventually visits every entry.
 */
export function createBoundedStore<V>(
  name: string,
  capacity: number,
  lifetimeLeft: (value: V, now: number) => number,
  now: Clock,
  onWarning?: WarningSink,
) {
  const entries = new Map<string, V>();
  let cursor: Iterator<[string, V]> | null = null;

  /** Sweeps up to `budget` entries; returns true when the cursor wrapped around. */
  const sweepStep = (budget: number): boolean => {
    const at = now();
    for (let i = 0; i < budget; i += 1) {
      cursor ??= entries.entries();
      const next = cursor.next();
      if (next.done) {
        cursor = null;
        return true;
      }
      const [key, value] = next.value;
      if (lifetimeLeft(value, at) <= 0) entries.delete(key);
    }
    return false;
  };

  const evictLeastTimeLeft = (): void => {
    const at = now();
    let victim: string | null = null;
    let least = Infinity;
    for (const [key, value] of entries) {
      const left = lifetimeLeft(value, at);
      if (left < least) {
        least = left;
        victim = key;
      }
    }
    if (victim !== null) {
      entries.delete(victim);
      onWarning?.('throttle_store_full', { store: name, capacity, evictedMsLeft: least });
    }
  };

  const makeRoom = (): void => {
    let passes = 0;
    while (entries.size >= capacity && passes < 2) {
      if (sweepStep(SWEEP_BUDGET)) passes += 1;
    }
    if (entries.size >= capacity) evictLeastTimeLeft();
  };

  return {
    get(key: string): V | undefined {
      const value = entries.get(key);
      if (value !== undefined && lifetimeLeft(value, now()) <= 0) {
        entries.delete(key);
        return undefined;
      }
      return value;
    },
    set(key: string, value: V): void {
      if (!entries.has(key) && entries.size >= capacity) makeRoom();
      entries.set(key, value);
    },
    delete(key: string): void {
      entries.delete(key);
    },
    size: () => entries.size,
  };
}

function createLimiter(rules: StoreRules, now: Clock): Limiter {
  const store = createBoundedStore<Entry>(
    rules.name,
    rules.capacity,
    rules.lifetimeLeft,
    now,
    rules.onWarning,
  );
  const retryAfterMs = (key: string): number => {
    const entry = store.get(key);
    return entry ? Math.max(0, rules.waitFor(entry, now())) : 0;
  };
  return {
    retryAfterMs,
    reserve: (key) => {
      const wait = retryAfterMs(key);
      if (wait > 0) return wait;
      const entry = store.get(key);
      const at = now();
      store.set(
        key,
        entry
          ? { count: entry.count + 1, startedAt: entry.startedAt, lastAt: at }
          : { count: 1, startedAt: at, lastAt: at },
      );
      return 0;
    },
    release: (key) => {
      const entry = store.get(key);
      if (!entry) return;
      if (entry.count <= 1) store.delete(key);
      else store.set(key, { ...entry, count: entry.count - 1 });
    },
    reset: (key) => store.delete(key),
    size: () => store.size(),
  };
}

export function createWindowLimiter(
  max: number,
  windowMs: number,
  now: Clock = Date.now,
  capacity = DEFAULT_STORE_CAPACITY,
  onWarning?: WarningSink,
  name = 'window',
): Limiter {
  return createLimiter(
    {
      name,
      capacity,
      onWarning,
      lifetimeLeft: (entry, at) => entry.startedAt + windowMs - at,
      waitFor: (entry, at) => (entry.count >= max ? entry.startedAt + windowMs - at : 0),
    },
    now,
  );
}

export interface BackoffOptions {
  readonly freeAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Failures older than this (and not locked out) are forgotten. */
  readonly decayMs: number;
  readonly capacity?: number;
  readonly onWarning?: WarningSink;
}

export function createBackoffLimiter(options: BackoffOptions, now: Clock = Date.now): Limiter {
  const delayFor = (count: number): number => {
    if (count < options.freeAttempts) return 0;
    const exponent = Math.min(count - options.freeAttempts, 20);
    return Math.min(options.baseDelayMs * 2 ** exponent, options.maxDelayMs);
  };
  const waitFor = (entry: Entry, at: number) => entry.lastAt + delayFor(entry.count) - at;
  return createLimiter(
    {
      name: 'login_email',
      capacity: options.capacity ?? DEFAULT_STORE_CAPACITY,
      onWarning: options.onWarning,
      waitFor,
      // Kept while locked out and until the failures have decayed.
      lifetimeLeft: (entry, at) =>
        Math.max(waitFor(entry, at), entry.lastAt + options.decayMs - at),
    },
    now,
  );
}

/**
 * Canonical client key for throttling: IPv4-mapped IPv6 collapses to IPv4, and
 * IPv6 addresses are reduced to their /64 prefix because one host typically
 * controls a whole /64 and could otherwise rotate addresses freely.
 */
export function normaliseIp(raw: string | null | undefined): string {
  const ip = (raw ?? '').trim().toLowerCase();
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1] as string;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const groups = ip.includes('::')
    ? [...headParts, ...Array(missing).fill('0'), ...tailParts]
    : headParts;
  const prefix = groups.slice(0, 4).map((g) => (g || '0').replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}

export interface AuthThrottle {
  /**
   * Reserves a login attempt for this IP and email before any I/O. Returns 0 when
   * the attempt may proceed (and is already counted as a failure), otherwise the
   * milliseconds to wait.
   */
  reserveLogin(ip: string, email: string): number;
  /** Returns the reservation: clears the email backoff and frees the IP slot. */
  recordLoginSuccess(ip: string, email: string): void;
  reserveRegistration(ip: string): number;
}

export interface AuthThrottleConfig {
  readonly LOGIN_MAX_ATTEMPTS: number;
  readonly LOGIN_WINDOW_MINUTES: number;
  readonly LOGIN_BACKOFF_BASE_SECONDS: number;
  readonly LOGIN_IP_MAX_ATTEMPTS: number;
  readonly LOGIN_IP_MAX_EMAILS: number;
  readonly REGISTER_IP_MAX_ATTEMPTS: number;
}

export interface AuthThrottleOptions {
  readonly now?: Clock;
  readonly capacity?: number;
  readonly onWarning?: WarningSink;
}

export function createAuthThrottle(
  config: AuthThrottleConfig,
  options: AuthThrottleOptions = {},
): AuthThrottle {
  const now = options.now ?? Date.now;
  const capacity = options.capacity ?? DEFAULT_STORE_CAPACITY;
  const windowMs = config.LOGIN_WINDOW_MINUTES * 60_000;
  const byEmail = createBackoffLimiter(
    {
      freeAttempts: config.LOGIN_MAX_ATTEMPTS,
      baseDelayMs: config.LOGIN_BACKOFF_BASE_SECONDS * 1000,
      maxDelayMs: windowMs,
      decayMs: windowMs * 4,
      capacity,
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    },
    now,
  );
  const byIp = createWindowLimiter(
    config.LOGIN_IP_MAX_ATTEMPTS,
    windowMs,
    now,
    capacity,
    options.onWarning,
    'login_ip',
  );
  const registrations = createWindowLimiter(
    config.REGISTER_IP_MAX_ATTEMPTS,
    60 * 60_000,
    now,
    capacity,
    options.onWarning,
    'register_ip',
  );
  const emailsByIp = createBoundedStore<{ startedAt: number; emails: ReadonlySet<string> }>(
    'login_ip_emails',
    capacity,
    (value, at) => value.startedAt + windowMs - at,
    now,
    options.onWarning,
  );

  /** Wait imposed when this IP would introduce one distinct email too many. */
  const emailFanOutWait = (ip: string, email: string): number => {
    const seen = emailsByIp.get(ip);
    if (!seen || seen.emails.has(email) || seen.emails.size < config.LOGIN_IP_MAX_EMAILS) return 0;
    return seen.startedAt + windowMs - now();
  };
  const noteEmail = (ip: string, email: string): void => {
    const seen = emailsByIp.get(ip);
    if (seen?.emails.has(email)) return;
    emailsByIp.set(
      ip,
      seen
        ? { startedAt: seen.startedAt, emails: new Set([...seen.emails, email]) }
        : { startedAt: now(), emails: new Set([email]) },
    );
  };

  return {
    reserveLogin: (rawIp, email) => {
      const ip = normaliseIp(rawIp);
      // Check everything before counting anything, so a blocked IP does not lock the account.
      const wait = Math.max(
        byEmail.retryAfterMs(email),
        byIp.retryAfterMs(ip),
        emailFanOutWait(ip, email),
      );
      if (wait > 0) return wait;
      noteEmail(ip, email);
      byEmail.reserve(email);
      byIp.reserve(ip);
      return 0;
    },
    recordLoginSuccess: (rawIp, email) => {
      byEmail.reset(email);
      byIp.release(normaliseIp(rawIp));
    },
    reserveRegistration: (rawIp) => registrations.reserve(normaliseIp(rawIp)),
  };
}
