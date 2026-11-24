# ADR-0020: Authentication throttle state — bounded caches over a non-evictable sketch (fail closed)

- **Status:** Accepted
- **Date:** 2026-11
- **Related:** ADR-0006, SP-012, SP-183, SP-190

## Context

Login and registration throttles (ADR-0006) keep per-email, per-IP and per-prefix
counters in process memory. Memory must be bounded, otherwise a client sending
requests for millions of distinct emails exhausts the heap. Every bounded store has
to answer one question when it is full of *active* entries:

- **Fail open** — evict something (oldest, least time left). Cheap and keeps the
  service available, but an attacker can flood the store with fresh keys until the
  victim's lock-out is evicted, then resume guessing at full speed.
- **Fail closed** — refuse or maximally delay new keys. Lock-outs can never be
  cleared, but the same flood now locks *everyone* out: a denial of service.

Neither extreme is acceptable for a login endpoint.

## Decision Drivers

- A flood must not be able to clear a victim's lock-out (brute-force resistance).
- A flood must not block unrelated users (availability).
- Constant, predictable memory; no unbounded structure on an unauthenticated path.
- No external services and no extra database round trip per login in M0/M1.

## Considered Options

1. Unbounded `Map` (rejected: memory exhaustion).
2. Bounded `Map`, evict least time left (fail open; rejected: flood clears lock-outs).
3. Bounded `Map`, refuse new keys when full (fail closed globally; rejected: flood is a DoS).
4. **Bounded `Map` as a precision cache over a fixed-size count-min sketch that is the
   source of truth for per-email lock-outs** (chosen).
5. PostgreSQL-backed counters (deferred to SP-190; needed for multi-instance anyway).

## Decision Outcome

Option 4.

- `apps/api/src/http/count-min-sketch.ts`: 4 rows x 16,384 counters keyed by
  `HMAC(SESSION_SECRET, normalised email)`, two rotating generations (windowed decay,
  failures forgotten after two generations of `4 x LOGIN_WINDOW_MINUTES`), plus a
  per-cell latest-failure timestamp. About 1 MiB, allocated once, nothing to evict.
- Every reserved login attempt is recorded in the sketch. The estimate (minimum over
  rows) never under-counts, and the timestamp estimate is never earlier than the
  truth, so a collision can only over-throttle that one bucket.
- The per-key `Map` keeps exact counts and is safe to evict from: a key missing from
  the cache is re-seeded from the sketch at no less than its true strength. A
  successful login writes an explicit zero entry so the cache, not the sketch's
  history, is authoritative for that user until the entry ages out.
- Per-IP windows and distinct-email caps (per /64 and per /48 for IPv6) remain plain
  bounded caches with sweep-then-evict-least-time-left and a warning log.

## Consequences

- Good: a flood cannot clear a victim's lock-out; unrelated users keep logging in
  (tests in `apps/api/test/unit.test.ts`); memory is fixed.
- Accepted residual risk (fail closed, but narrowly):
  - a user whose zero "cleared" entry is evicted and whose bucket collides with
    attacker traffic may be throttled for up to one login window;
  - the per-IP and per-prefix caches still evict under extreme pressure, so the
    spraying guard can weaken while the per-email lock-outs hold;
  - the sketch is per process and lost on restart.
- Follow-up: SP-190 moves all throttle state to PostgreSQL (shared across instances,
  survives restarts) and is a prerequisite for running more than one API instance
  (with SP-183).
