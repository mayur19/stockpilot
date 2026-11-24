# ADR-0006: Session authentication, CSRF, RBAC and authentication throttling

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-010, SP-011, SP-012, SP-013; follow-ups SP-009, SP-015, SP-016, SP-017, SP-183, SP-190; see also ADR-0020

## Context and problem statement

StockPilot is a browser-first operations tool used on shared warehouse terminals. It needs authentication that survives page reloads, can be revoked server-side instantly (a dismissed operator must lose access now), resists CSRF and online password guessing, and does not reveal which emails have accounts. It must not depend on any external identity provider (ADR-0003).

## Decision drivers

- Immediate server-side revocation (logout, deactivated user).
- No tokens readable by injected script for the session credential.
- Defence against credential stuffing on one account **and** password spraying across many accounts.
- No account enumeration through login, registration or timing.
- Client IP must be trustworthy for per-IP limits, which depends on the proxy topology.
- Authorisation expressed as permissions so custom roles (SP-016) need no handler changes.

## Considered options

1. Opaque random session token in an HttpOnly cookie, server-side session row in PostgreSQL, CSRF double-submit token, permission-based RBAC, in-process throttles.
2. Stateless JWT access token + refresh token in cookies.
3. JWT in `localStorage` with `Authorization: Bearer`.
4. External OIDC provider.

## Decision outcome

Chosen option: **1**.

**Passwords.** scrypt via `node:crypto` with N=2^15, r=8, p=1, 64-byte key and a 16-byte random salt, stored as `scrypt$N$r$p$salt$key` so parameters can be raised later. Verification uses `timingSafeEqual`. For unknown emails the code verifies against a fixed `DUMMY_HASH` so the response time matches a real account.

**Sessions.** Login creates a 32-byte random token (`base64url`). The database stores only `HMAC-SHA256(SESSION_SECRET, token)` as `sessions.id`, so a database leak cannot be replayed without the secret. Cookie `sp_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, expiry `SESSION_TTL_HOURS` (default 12). Each request loads the session joined to an **active** user and its organisation where `expires_at > now()`; `last_seen_at` is touched at most once per minute. Logout deletes the row.

**CSRF.** A second random token is stored on the session row and sent in the non-HttpOnly cookie `sp_csrf`. The SPA echoes it in `X-CSRF-Token`; the preHandler rejects any non-GET/HEAD/OPTIONS request on a protected route unless the header equals the session's token (constant-time compare) with `403 CSRF_INVALID`. Public `register`/`login` routes rely on `SameSite=Lax` and the JSON-only body parser (cross-site forms cannot send `application/json` without a CORS preflight, which the API never grants).

**RBAC.** Roles (`owner`, `admin`, `manager`, `operator`, `viewer`) map to permission lists in `packages/shared/src/roles.ts`. Routes declare `config: { permission: 'inventory:move' }` (or `'authenticated'`); the preHandler returns 401 without a session and 403 without the permission. Handlers never check role names.

**Throttling** (`apps/api/src/http/rate-limiter.ts`):

| Limiter                       | Key                                      | Rule (defaults)                                                                                                                                                                                                                | Purpose                                                                      |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Per-email progressive backoff | normalised email                         | first `LOGIN_MAX_ATTEMPTS`=5 attempts free; then lock-out of `LOGIN_BACKOFF_BASE_SECONDS`=30 s doubling per further failure, capped at `LOGIN_WINDOW_MINUTES`=15 min; failures forgotten after 4x the window; reset on success | Targeted guessing against one account from many IPs                          |
| Per-IP spraying window        | normalised IP                            | `LOGIN_IP_MAX_ATTEMPTS`=50 attempts per 15-min fixed window across all emails; a successful login gives back only its own slot, so the window is **not** reset                                                                 | Password spraying (one password, many accounts)                              |
| Per-IP email fan-out          | normalised IP, and for IPv6 also the /48 | at most `LOGIN_IP_MAX_EMAILS`=20 distinct emails introduced per window per /64 (or IPv4 address), and 4x that (80) per IPv6 /48                                                                                                | Bounds spraying breadth and how fast one client can grow the per-email store |
| Registration limiter          | normalised IP                            | `REGISTER_IP_MAX_ATTEMPTS`=10 per hour                                                                                                                                                                                         | Mass workspace creation                                                      |

- **Reservation, not after-the-fact counting.** `reserveLogin(ip, email)` runs synchronously before the first `await`: it checks all three login limiters first (so a blocked IP never adds to an account's backoff) and, if allowed, counts the attempt as a failure immediately. `recordLoginSuccess` then clears the email backoff and releases the IP slot. Because Node runs the check-and-count without yielding, a burst of concurrent requests cannot all pass the check before the first failure is recorded — a test fires 20 parallel bad logins and exactly `LOGIN_MAX_ATTEMPTS` reach password verification. `reserveRegistration` works the same way.
- **IP normalisation.** IPv4-mapped IPv6 (`::ffff:a.b.c.d`) collapses to IPv4, and IPv6 addresses are reduced to their /64 prefix, because one host usually controls a whole /64 and could otherwise rotate addresses freely.
- **Bounded memory without silently clearing lock-outs (ADR-0020).** The per-key Maps hold at most 100 000 entries each, and the per-email Map is **authoritative** whenever it has an entry; a successful login writes an explicit zero entry, so a reset always wins. When a store is full, a resumable cursor sweeps lapsed entries; only if every entry is still active is the one with the least time left evicted with a `throttle_store_full` warning. For the per-email store, an evicted **active** entry is absorbed into a fixed-size count-min sketch (`http/count-min-sketch.ts`, 4 x 16 384 counters, about 1 MiB, keyed by `HMAC(SESSION_SECRET, email)` so collisions cannot be aimed at a victim, two rotating generations for decay, per-cell latest-failure timestamp). Ordinary failures never write to the sketch, and it is read only for keys with no precise Map entry, so a flood cannot clear a victim's lock-out and failures spread across many emails never lock out an untouched email. If any sketch row is more than 50% occupied the sketch is ignored, a `throttle_sketch_saturated` alert is logged and a counter incremented (a deliberate fail-open choice for availability). Per-IP windows and fan-out caps are plain bounded maps (they can still evict under extreme pressure).

Throttled requests get `429 RATE_LIMITED` with `Retry-After`.

**Non-enumerating registration.** `POST /auth/register` always answers `202 { status: "accepted", message }` and never issues a session. The password is hashed before the email lookup so both paths cost the same; a duplicate is recorded only as an `auth.register_duplicate` audit event; a concurrent duplicate that loses the unique-index race gets the same answer. The user signs in afterwards. Email ownership is verified via the local outbox in SP-009.

**Proxy trust.** `TRUST_PROXY` defaults to `false` in development and test, and **must be set explicitly when `NODE_ENV=production`** (startup fails otherwise, so nobody deploys behind nginx with the default by accident). With `false`, so `request.ip` is the socket peer and `X-Forwarded-For` is ignored. Behind nginx it is set to a hop count (`1`) or a list of proxy IPs/CIDRs; a number `n` trusts exactly the nearest `n` hops. `true` is rejected by config validation because it would let any client choose its own IP and bypass every per-IP limit.

**Counter storage.** All limiter stores keep their counters in process memory. This is correct for the single-instance deployment (ADR-0019). **Before more than one API process runs, the counters must move to PostgreSQL (SP-183 hardening, delivered by the shared throttle store SP-190)**, otherwise the attempt budget multiplies by the instance count and resets on restart.

### Consequences

- Good: revocation is a `DELETE`; deactivating a user invalidates sessions on the next request.
- Good: no credential is ever readable by page script; CSRF token exposure alone is useless without the HttpOnly cookie.
- Good: spraying and stuffing are both bounded, including under concurrent bursts; tests cover each limiter, the 20-request parallel burst and the `X-Forwarded-For` rotation bypass.
- Good: throttle memory is bounded and cannot be turned into a lock-out by flooding new keys.
- Bad: one session lookup per request (an indexed primary-key join; acceptable).
- Bad: per-email lock-out can be abused to lock a known user out for up to 15 minutes; accepted trade-off, revisited in SP-183 (per-email-per-IP keying, CAPTCHA-free proof of work).
- Bad: throttle state (maps and sketch) is per process, lost on restart and not shared across instances until SP-190.
- Bad: an email with no precise entry whose sketch cells collide in every row with absorbed lock-outs may be over-throttled for at most one login window; if the sketch saturates it is ignored and evicted lock-outs are lost, made visible by the alert and counter (ADR-0020).
- Bad: registration creates the organisation immediately without proving email ownership until SP-009.
