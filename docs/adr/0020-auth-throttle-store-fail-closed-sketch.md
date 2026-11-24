# ADR-0020: Authentication throttle state — bounded authoritative maps with an overflow sketch for evicted lock-outs

- **Status:** Accepted
- **Date:** 2026-11
- **Related:** ADR-0006, SP-012, SP-183, SP-190

## Context

Login and registration throttles (ADR-0006) keep per-email, per-IP and per-prefix
counters in process memory. Memory must be bounded, otherwise a client sending
requests for millions of distinct emails exhausts the heap. Every bounded store has
to answer one question when it is full of _active_ entries:

- **Fail open** — evict something (oldest, least time left). Cheap and keeps the
  service available, but an attacker can flood the store with fresh keys until the
  victim's lock-out is evicted, then resume guessing at full speed.
- **Fail closed** — refuse or maximally delay new keys. Lock-outs can never be
  cleared, but the same flood now locks _everyone_ out: a denial of service.

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
4. Sketch as the source of truth, written on every failure (rejected: failures spread
   across many emails fill the sketch and eventually lock out untouched emails; a
   reset on successful login cannot be expressed in a count-min sketch).
5. **Bounded authoritative `Map`; force-evicted _active_ entries spill into a
   fixed-size count-min sketch that is read only for keys without a precise entry**
   (chosen).
6. PostgreSQL-backed counters (deferred to SP-190; needed for multi-instance anyway).

## Decision Outcome

Option 5.

- The per-email `Map` holds exact counts and is authoritative whenever it has an entry
  for the key. A successful login writes an explicit zero entry, so a reset always wins.
- When the store is full, a resumable cursor first sweeps lapsed entries across the
  whole map. Only if every entry is still active is the entry with the least time left
  evicted, with a `throttle_store_full` warning — and that evicted entry's failure count
  and latest failure time are absorbed into the sketch.
- `apps/api/src/http/count-min-sketch.ts`: 4 rows x 16,384 counters keyed by
  `HMAC(SESSION_SECRET, normalised email)`, per-cell latest-failure timestamp, two
  rotating generations of `4 x LOGIN_WINDOW_MINUTES` for decay; about 1 MiB, allocated
  once, nothing to evict. Ordinary failures never write to it.
- The sketch is read only for keys with no precise entry. Its count estimate (minimum
  over rows) never under-counts what was absorbed and its timestamp estimate is never
  earlier than the truth, so an evicted lock-out returns at full strength.
- Saturation guard: if any row is more than 50% occupied the sketch is ignored for
  reads, a `throttle_sketch_saturated` alert is logged and a counter
  (`stats().saturatedReads`) is incremented — a saturated sketch would otherwise start
  over-throttling unrelated users.
- Per-IP windows and distinct-email caps (per /64 and per /48 for IPv6) remain plain
  bounded maps with sweep-then-evict-least-time-left and a warning log.

## Consequences

- Good: an evicted active lock-out is still enforced; failures spread across many
  emails never lock out an untouched email; a successful login clears the lock-out;
  memory is fixed (tests in `apps/api/test/unit.test.ts`).
- Accepted residual risk:
  - if the sketch saturates (an attacker forcing more than ~8,000 active lock-out
    evictions per generation), it is ignored and evicted lock-outs are lost — the
    deliberate fail-open choice for availability, made visible by the alert and counter;
  - a key colliding in every row with absorbed entries may be over-throttled for at most
    one login window (fail closed, one bucket only);
  - per-IP and per-prefix caches can still evict under extreme pressure, weakening the
    spraying guard while per-email lock-outs hold;
  - all state is per process and lost on restart.
    Further findings in this area are tracked against this ADR rather than iterated on
    in memory; the durable fix is SP-190.
- Follow-up: SP-190 moves all throttle state to PostgreSQL (shared across instances,
  survives restarts) and is a prerequisite for running more than one API instance
  (with SP-183).
