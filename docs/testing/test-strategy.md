# Test strategy

StockPilot is a stock system, so the expensive failures are silent: an oversold unit, a
projection that drifts away from the ledger, or a case quantity rounded the wrong way. The test
suite is weighted towards catching exactly those. Pure domain rules are tested exhaustively and
with randomised properties. The database-backed invariants (row locks, CHECK constraints,
append-only trigger) are tested against a real PostgreSQL, never a mock.

## Pyramid

```
                 ┌──────────────────────────┐
                 │ Playwright smoke (2)      │  e2e/tests/smoke.spec.ts — manual / ./run.sh e2e
                 ├──────────────────────────┤
                 │ Web RTL (26)              │  apps/web/test — jsdom, fetch stubbed
             ┌───┴──────────────────────────┴───┐
             │ API integration (43, real PG)     │  apps/api/test/*.db.test.ts + app.http.test.ts
             ├───────────────────────────────────┤
             │ API unit (30)                     │  apps/api/test/unit.test.ts
       ┌─────┴───────────────────────────────────┴─────┐
       │ Shared domain unit + randomised props (77)    │  packages/shared/test
       └───────────────────────────────────────────────┘
```

Counts are `it(...)` cases at the time of writing (executed cases, parameterised tests expanded): shared 77, API 73 (30 unit, 9 HTTP shell,
34 database), web 26, e2e 2. The runner for everything except e2e is Vitest 3, with coverage
from `@vitest/coverage-v8`.

## What is tested where

### Shared domain (`packages/shared/test`)

These are pure functions with no I/O. They hold the hard algorithms, so they carry the highest
coverage threshold.

| File                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uom.test.ts`        | Ladder validation (nested factors, duplicates, bad codes, factor < 2), `toBaseUnits`, exact `convertQuantity` that refuses to round, overflow, greedy `breakdownQuantity`. **Randomised:** every level round-trips and every breakdown sums back to the input.                                                                                                                                                   |
| `ledger.test.ts`     | `effectsOf` per movement type, `applyEffect` immutability and invariants (on hand >= 0, allocated <= on hand, no over-release), `projectBalances`, `diffBalances` (drift, missing and phantom rows, empty rows ignored). **Randomised:** 500 random moves conserve total on hand (seeded LCG, reproducible).                                                                                                     |
| `allocation.test.ts` | FEFO/FIFO/LIFO ordering and tie-breaks, eligibility (expired, shelf-life boundary, on hold, empty), best-fit single bin vs largest-first draining, pick-sequence tie-breaks, partial vs fill-or-kill, multi-line shared pool, ship-complete. **Randomised:** 300 seeded trials show the plan never over-allocates, never uses an excluded row, keeps `allocated + shortfall = requested`, and honours FEFO rank. |
| `bin-code.test.ts`   | Structured vs free-form codes, rejected forms, serpentine `defaultPickSequence`.                                                                                                                                                                                                                                                                                                                                 |
| `misc.test.ts`       | Calendar date arithmetic and validation, quantity bounds, strictly growing role permission sets, zod schema normalisation (lower-cased email, upper-cased codes, fractional quantities rejected, at least one allocation line).                                                                                                                                                                                  |

The randomised tests use fixed seeds, so a failure always reproduces. To explore more of the
input space locally, change the seed or the trial count. They are written so that no extra
dependency is needed.

### API unit (`apps/api/test/unit.test.ts`)

These tests need no database: config loading (defaults, readable failures, refusal of the
placeholder secret in production, **`TRUST_PROXY` must be set explicitly in production**,
hop counts and CIDR lists, `true` rejected), scrypt hashing and session-id HMAC, error mapping
(domain codes to statuses, PG `23505/23514/23503/40P01` to envelope codes), zod `parse` issue
paths, warehouse-local `todayIn`, time zone canonicalisation, and the auth throttle in depth:

- synchronous reservation, where a burst lets exactly N attempts through;
- progressive per-email backoff and its cap;
- the per-IP spraying window, where a success frees only its own slot;
- the cap on distinct emails per IP (`LOGIN_IP_MAX_EMAILS`) and per IPv6 /48 across rotating /64s;
- registration limits;
- bounded stores: full stores never lock out new keys, expired entries are swept before
  anything is evicted, and when everything is still active the entry with the least time left
  is evicted with a warning;
- the overflow sketch for evicted lock-outs: an evicted active lock-out is still enforced after
  a flood, failures spread across many emails never lock out an untouched email, a successful
  login clears the lock-out even after an earlier eviction, the sketch returns what was absorbed,
  decays after two rotation periods and ignores unknown keys, it is ignored (with an alert event
  and a counter) once a row is over half full, and invalid dimensions are rejected;
- normalisation of IPv4-mapped addresses and IPv6 /64 prefixes;
- decay and reset.

### API integration (`apps/api/test/*.db.test.ts`, `app.http.test.ts`)

- **Real PostgreSQL**, no mocks. `global-setup.ts` drops and recreates the `public` schema of
  `TEST_DATABASE_URL` once per run and applies every migration through the production runner.
  Files run sequentially (`fileParallelism: false`) because they share that schema. Each test
  registers its own organisation, so tests stay isolated by tenancy instead of by truncation.
- Requests go through `app.inject` against the fully built Fastify app: the same hooks, auth,
  CSRF, error handler and serializers as production.
- Without `TEST_DATABASE_URL` the database suites are skipped (`describe.skipIf`) and a warning
  is printed. CI always sets it, so nothing is skipped there.

| Suite                   | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.http.test.ts`      | Security headers, request-id echo and replacement, `ROUTE_NOT_FOUND`, `401` envelope, validation before I/O, malformed JSON, **every pending endpoint is registered and needs auth**, ticket format `SP-###`, `trustProxyOption` never trusts everyone.                                                                                                                                                                                                               |
| `auth.db.test.ts`       | Register (202, no cookies, non-enumerating), login cookies, `/me`, logout invalidates server-side, generic bad-credential error, email backoff across IPs, **20 concurrent bad logins: exactly `LOGIN_MAX_ATTEMPTS` (3 in the suite) get 401 and the rest 429**, IP spraying guard with `Retry-After`, CSRF required, RBAC per role, audit rows, 501 with ticket when signed in, readiness, registration throttle, `X-Forwarded-For` ignored unless a hop is trusted. |
| `inventory.db.test.ts`  | Bin code validation and serpentine sequence, unknown time zones, tenant isolation, UoM ladder validation, receipts in pack units creating lots, lot/expiry rules and `LOT_EXPIRY_MISMATCH`, moves refusing more than available, adjustments with reasons and no negative stock, keyset pagination of the ledger, **append-only trigger rejects UPDATE/DELETE**, projection verify detects injected drift.                                                             |
| `allocation.db.test.ts` | FEFO from STORAGE/PICK only with shelf life, FIFO override and pack units, partial vs ship-complete `INSUFFICIENT_STOCK`, duplicate live `orderRef` and unknown SKU, release exactly once, allocated units cannot be moved, **concurrency: 12 ship-complete orders of 5 race for 39 units, so exactly 7 succeed, 5 get 409, 35 are allocated, no row has allocated > on hand, and verify stays consistent**, projection consistent after mixed operations.            |

The concurrency test is the no-oversell guarantee. All 12 requests run in parallel over a pool
of 20 connections. Correctness rests on `SELECT ... FOR UPDATE` taken in a deterministic
`(sku_id, id)` order and on the `allocated <= on_hand` CHECK as a backstop. If either is
removed, the test fails (oversell) or deadlocks, and a deadlock surfaces as `CONCURRENCY_RETRY`.

### Web (`apps/web/test`)

React Testing Library on jsdom, with `fetch` stubbed per test and fixtures in `fixtures.ts`:

| File                    | Covers                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.test.ts`        | CSRF cookie parsing, CSRF header only on mutations, envelope unwrapping, `ApiRequestError`, 204 and non-JSON failures, first validation issue in messages.                                                                         |
| `LoginPage.test.tsx`    | Server error shown on bad credentials; navigation to the stock screen on success.                                                                                                                                                  |
| `BalanceTable.test.tsx` | Empty state, pack breakdown, expiry flag, move action only when stock is available.                                                                                                                                                |
| `forms.test.tsx`        | Receive form asks for lot/expiry only for tracked SKUs and posts pack units; move form excludes the source bin and reports insufficient stock; allocation form sends strategy/shelf life/ship-complete and shows shortfall errors. |
| `navigation.test.tsx`   | Live vs planned nav items with tickets, placeholder page, unknown slug, format helpers.                                                                                                                                            |
| `pages.test.tsx`        | Anonymous redirect, stock page filters and move form, allocation list/detail/release, sign-out.                                                                                                                                    |

### End-to-end smoke (`e2e/tests/smoke.spec.ts`)

Two Playwright specs log in as `operator@stockpilot.test`. One checks the stock-on-hand table
(it expects `MILK-UHT-1L`) and the receive form. The other opens a Planned section and checks
its ticket badge (`SP-100`).

**Not run in CI.** The runner would need a browser download and a seeded database with the dev
server running, and the integration suite already covers the same paths below the UI. Run them
locally:

```bash
./run.sh e2e            # setup + seed, installs Chromium if possible, then npm run test:e2e
# or, with the app already running via ./run.sh:
npx playwright install chromium
npm run test:e2e        # reuses the running dev server outside CI (reuseExistingServer)
```

The HTML report goes to `e2e/report/` and traces of failed tests to `e2e/test-results/`.
`WEB_PORT` overrides the default port 5103.

## Coverage thresholds

Thresholds are enforced by `npm run test:coverage` in each workspace (CI runs this) and apply
to implemented code only. Pending routes are one generic handler, so they need no exclusion.

| Workspace         | Lines | Branches | Functions | Statements | Excluded                                                                                      |
| ----------------- | ----: | -------: | --------: | ---------: | --------------------------------------------------------------------------------------------- |
| `packages/shared` |    90 |       85 |        90 |         90 | `src/index.ts`, barrel `index.ts` files                                                       |
| `apps/api`        |    80 |       70 |        80 |         80 | `src/index.ts`, `src/db/cli.ts`, `src/db/seed.ts` (exercised by the CI `db:reset` smoke step) |
| `apps/web`        |    80 |       75 |        75 |         80 | `src/main.tsx`                                                                                |

## How to run

```bash
./run.sh test                         # creates <db>_test if missing, runs every workspace
npm test -w @stockpilot/shared        # domain only, no database needed
TEST_DATABASE_URL=postgresql://localhost:5432/stockpilot_test?host=/tmp npm test -w @stockpilot/api
npm run test:coverage                 # with thresholds, as CI does
./run.sh check                        # lint + format:check + typecheck + tests
```

The CI job (`.github/workflows/ci.yml`) starts the runner's own PostgreSQL service, creates the
`stockpilot` role and the `stockpilot_test` database, then runs `lint`, `format:check`,
`typecheck`, `test:coverage` and `build`. A final step runs `db:reset` (drop schema, migrate,
seed) against the same database as a smoke test of the migrations and the seed.

## Acceptance test matrix

| Feature (ticket)                       | Acceptance criterion                                                                                            | Test(s)                                                                                                                     | Status |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| Config loader (SP-002)                 | Bad config fails fast; production needs an explicit `TRUST_PROXY` and a real secret                             | `unit.test.ts` › loadEnv, TRUST_PROXY                                                                                       | pass   |
| Envelope, request ids, health (SP-003) | Every response is enveloped; ids echoed or newly assigned; readiness reports migrations                         | `app.http.test.ts`; `auth.db.test.ts` › readiness                                                                           | pass   |
| Migration runner (SP-004)              | All migrations apply in order inside transactions                                                               | `global-setup.ts` (every run); CI `db:reset` step                                                                           | pass   |
| Registration (SP-010)                  | 202 with a generic body, no cookies, no enumeration                                                             | `auth.db.test.ts` › registers an owner…, does not reveal…                                                                   | pass   |
| Sessions + CSRF (SP-011)               | HttpOnly session; mutations need `X-CSRF-Token`; logout invalidates server-side                                 | `auth.db.test.ts` › logs in, logs out…, requires the CSRF header…; `client.test.ts`                                         | pass   |
| Auth throttling (SP-012)               | Email backoff, IP spraying guard, email fan-out cap, burst-safe reservation, registration limit, proxy-aware IP | `unit.test.ts` › auth throttle; `auth.db.test.ts` › email limiter, 20 concurrent, IP limiter, registration, X-Forwarded-For | pass   |
| RBAC (SP-013)                          | Each role reaches only its permissions                                                                          | `auth.db.test.ts` › enforces RBAC; `misc.test.ts` › roles                                                                   | pass   |
| Audit (SP-014)                         | Registration and login write audit rows                                                                         | `auth.db.test.ts` › writes audit events                                                                                     | pass   |
| Topology (SP-020)                      | Bin codes validated; serpentine sequence; canonical time zones; tenant isolation                                | `bin-code.test.ts`; `inventory.db.test.ts` › bin codes, time zones                                                          | pass   |
| UoM ladders (SP-030)                   | Nested ladders only; exact conversion, never rounded                                                            | `uom.test.ts`; `inventory.db.test.ts` › UoM ladders, pack units                                                             | pass   |
| Lots and expiry (SP-031)               | Lot/expiry required exactly when tracked; expiry conflict rejected; auto lots                                   | `inventory.db.test.ts` › lot and expiry rules                                                                               | pass   |
| Ledger (SP-040)                        | Receipt/move/adjust append movements; no negative stock; append-only                                            | `ledger.test.ts`; `inventory.db.test.ts` › moves, adjusts, append-only, keyset                                              | pass   |
| Projection verify (SP-041)             | Replay equals stored balances; drift detected                                                                   | `ledger.test.ts` › diffBalances; `inventory.db.test.ts` › verifies…; `allocation.db.test.ts` › consistent                   | pass   |
| Allocation engine (SP-050)             | FEFO/FIFO/LIFO, eligibility, pick minimisation, partial/fill-or-kill                                            | `allocation.test.ts` (incl. randomised)                                                                                     | pass   |
| Concurrency-safe allocation (SP-051)   | No oversell under concurrency; duplicate live orderRef rejected                                                 | `allocation.db.test.ts` › never oversells…, duplicate…                                                                      | pass   |
| Release (SP-055)                       | Release returns stock exactly once via DEALLOCATE entries                                                       | `allocation.db.test.ts` › releases… exactly once                                                                            | pass   |
| Web shell (SP-060)                     | Login, redirect, planned sections with tickets                                                                  | `LoginPage.test.tsx`, `navigation.test.tsx`, `pages.test.tsx`; `smoke.spec.ts`                                              | pass   |
| Stock and allocation screens (SP-061)  | Balances with breakdown; receive/move/allocate forms; release                                                   | `BalanceTable.test.tsx`, `forms.test.tsx`, `pages.test.tsx`; `smoke.spec.ts`                                                | pass   |
| Demo seed (SP-062)                     | Seed loads on a clean schema                                                                                    | CI `db:reset` step; `smoke.spec.ts` (local)                                                                                 | pass   |
| Pending surface (all pending tickets)  | Every catalogue route answers 401 anonymous and 501 + ticket when signed in                                     | `app.http.test.ts` › registers every pending endpoint; `auth.db.test.ts` › answers 501                                      | pass   |

## Planned test work

| Ticket     | Work                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP-185     | End-to-end suite across critical flows (receive → putaway → allocate → pick → pack → ship) running in CI with a pre-seeded database.                    |
| SP-181     | Load tests for allocation and ledger append: p95 latency targets, hot-SKU contention, deadlock and `CONCURRENCY_RETRY` rate.                            |
| SP-100     | Property tests for pick paths: the route visits every bin exactly once and 2-opt never beats the exact optimum on small instances (brute-force oracle). |
| SP-111     | Cartonization property tests: no overlap, no item outside its carton, weight limits respected, fill ratio compared with a baseline.                     |
| SP-043/044 | Replay from snapshot equals full replay (differential test over randomised ledgers).                                                                    |
| SP-183     | Multi-instance throttle tests once counters move to Postgres; ASVS L2 security regression cases.                                                        |
| SP-184     | Automated accessibility checks on every live screen.                                                                                                    |
| SP-182     | Scripted backup/restore drill that ends with `projection/verify` returning `consistent: true`.                                                          |
| —          | Mutation testing of `packages/shared/src/domain` to check the strength of the property assertions.                                                      |
