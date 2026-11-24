# StockPilot — Requirements

Functional (FR) and non-functional (NFR) requirements for the full target product. Each requirement carries a MoSCoW priority, a status that matches the code and [../planning/backlog.md](../planning/backlog.md), the delivering ticket(s), and testable acceptance criteria. Traceability to code and tests is in [requirements-traceability.md](requirements-traceability.md).

**Status values.** `implemented` — behaviour exists in the code and is described exactly as built. `pending` — planned; the endpoint (where one exists) answers `501 NOT_IMPLEMENTED` with `details.ticket` set to the ticket shown.

**Conventions used in acceptance criteria.** All API responses use the envelope `{ "data": …, "error": null | { "code", "message", "details"? }, "meta"? }`. Quantities are whole numbers in the SKU's base unit unless a `uom` is given. "Available" means `on_hand − allocated`.

**Totals.** 112 functional requirements (50 implemented, 62 pending) and 27 non-functional requirements (19 implemented, 8 pending).

---

## 1. Functional requirements

### E01 — Platform foundation

#### FR-001 Validated configuration

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-002
- **Acceptance criteria:**
  1. On start-up the API parses its environment with a Zod schema; any invalid or missing value stops the process with `Invalid configuration: <path>: <message>; …`.
  2. `DATABASE_URL` is required; `SESSION_SECRET` must be at least 32 characters.
  3. Defaults apply when unset: `API_PORT=4103`, `APP_ORIGIN=http://localhost:5103`, `SESSION_TTL_HOURS=12`, `LOGIN_MAX_ATTEMPTS=5`, `LOGIN_WINDOW_MINUTES=15`, `LOGIN_BACKOFF_BASE_SECONDS=30`, `LOGIN_IP_MAX_ATTEMPTS=50`, `LOGIN_IP_MAX_EMAILS=20`, `REGISTER_IP_MAX_ATTEMPTS=10`; `TRUST_PROXY` defaults to `false` outside production.
  4. With `NODE_ENV=production`, a `SESSION_SECRET` that still contains `replace-me` is rejected.
  5. With `NODE_ENV=production`, start-up fails unless `TRUST_PROXY` is set explicitly (`false`, a hop count, or proxy IPs/CIDRs).

#### FR-002 Error envelope, request IDs and security headers

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-003
- **Acceptance criteria:**
  1. Every error, including unknown routes (`404 ROUTE_NOT_FOUND`), malformed JSON (`400`), wrong content type (`415 UNSUPPORTED_MEDIA_TYPE`) and unexpected failures (`500 INTERNAL_ERROR`), is returned in the envelope with `data: null`.
  2. Validation failures return `400 VALIDATION_FAILED` with `details` listing each issue's `path` and `message`.
  3. Domain errors map to statuses: `INVALID_QUANTITY`, `INVALID_UOM`, `NON_INTEGRAL_CONVERSION`, `INVALID_UOM_LADDER`, `INVALID_BIN_CODE`, `INVALID_DATE`, `INVALID_MOVEMENT` → 400; `INSUFFICIENT_AVAILABLE`, `INSUFFICIENT_ALLOCATED` → 409.
  4. PostgreSQL errors map as: unique violation → `409 ALREADY_EXISTS`; check violation → `409 CONSTRAINT_VIOLATION`; foreign key violation → `400 VALIDATION_FAILED`; deadlock or serialisation failure → `503 CONCURRENCY_RETRY`.
  5. An incoming `X-Request-Id` matching `^[A-Za-z0-9._-]{8,64}$` is echoed; otherwise a UUID is assigned. The response always carries `x-request-id`.
  6. Every response sets `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `cross-origin-opener-policy: same-origin`, `content-security-policy: default-src 'none'; frame-ancestors 'none'` and `cache-control: no-store`.

#### FR-003 Health and readiness

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-003
- **Acceptance criteria:**
  1. `GET /api/v1/health` returns `200 { status: "ok", uptimeSeconds }` without a database call.
  2. `GET /api/v1/ready` returns `200 { status: "ready", database: "up", migrations: <count of applied migrations> }`.
  3. When the database is unreachable or not migrated, `/ready` returns `503 NOT_READY`.

#### FR-004 Forward-only migrations with checksums

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-004
- **Acceptance criteria:**
  1. Files named `NNNN_description.sql` in `apps/api/migrations` are applied in lexical order, each in its own transaction, and recorded in `schema_migrations` with a SHA-256 checksum.
  2. Already-applied migrations are skipped; a changed checksum aborts with "was modified after being applied; add a new migration instead".
  3. There are no down migrations.

#### FR-005 Pending endpoints answer 501 with their ticket

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-003
- **Acceptance criteria:**
  1. Each of the 60 entries in the pending catalogue is registered at its target method and path.
  2. Without a session the route answers `401 UNAUTHENTICATED`; with a session it answers `501` with `error.code = "NOT_IMPLEMENTED"`, a message naming the feature, and `details.ticket` matching `SP-###`.
  3. Mutating pending routes are still subject to the CSRF check (FR-012).

#### FR-006 Launcher and demo data

- **Priority:** Should · **Status:** implemented · **Tickets:** SP-006, SP-062
- **Acceptance criteria:**
  1. `./run.sh` checks for Node.js 22+ and `psql`, writes `.env` with a random 64-hex-character `SESSION_SECRET` if missing, creates the database if absent, migrates, seeds when no users exist, and starts API and web.
  2. Database names are restricted to `[A-Za-z0-9_]+` before being used in SQL.
  3. The seed creates owner, manager, operator and viewer accounts, a warehouse with receiving (`RCV01`, `RCV02`), ambient reserve (`A-01-01-1-A` … `A-03-04-1-A`), forward pick (`P-01-01-0-A` … `P-01-06-0-A`) and quarantine (`QCAGE1`) bins, SKUs, receipts, moves and an allocation, all posted through the real services.

#### FR-007 Web shell with planned sections

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-060
- **Acceptance criteria:**
  1. Anonymous users are redirected to the login page; after login the user lands on _Stock on hand_.
  2. A bad login shows the server's error message.
  3. Navigation groups _Inventory_, _Inbound_, _Outbound_ and _Setup_; live items are _Stock on hand_ and _Allocations_; every other item shows a _Planned_ badge and opens a placeholder naming its ticket (e.g. _Cycle counts_ → SP-130, _Picking_ → SP-100).
  4. The top bar offers sign-out, which calls `POST /auth/logout` and returns to the login page.

### E02 — Identity & access

#### FR-008 Non-enumerating owner registration

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-010
- **Acceptance criteria:**
  1. `POST /api/v1/auth/register` with `organizationName` (2–120), `name` (1–120), `email` (trimmed, lower-cased, ≤ 254) and `password` (12–200 characters) creates an organisation and an `owner` user.
  2. The response is always `202 { status: "accepted", message: "If this email can be registered, the workspace is ready. Sign in to continue." }`, whether or not the email already exists, and **no session cookie is set**.
  3. The password is hashed before the existence check so both paths cost the same; a concurrent duplicate that loses the unique-index race receives the same 202.
  4. A duplicate attempt records `auth.register_duplicate` against the existing user; a new registration records `organization.registered`.

#### FR-009 Login and session issuance

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-010, SP-011
- **Acceptance criteria:**
  1. `POST /api/v1/auth/login` with valid credentials of an active user returns `200 { user, csrfToken }` and sets `sp_session` (httpOnly) and `sp_csrf` (readable by the SPA), both `SameSite=Lax`, `Path=/`, `Secure` in production, expiring after `SESSION_TTL_HOURS`.
  2. Unknown email, wrong password and inactive user all return `401 INVALID_CREDENTIALS` "Email or password is incorrect"; an unknown email is verified against a dummy hash so timing does not reveal existence.
  3. Each failure records `auth.login_failed`; each success records `auth.login` and updates `last_login_at`.

#### FR-010 Logout and current user

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-010
- **Acceptance criteria:**
  1. `POST /api/v1/auth/logout` deletes the session row, clears both cookies and returns `204`; reusing the old cookie then yields `401`.
  2. `GET /api/v1/auth/me` returns `{ user: { id, email, name, role }, organization: { id, name }, csrfToken }`.

#### FR-011 PostgreSQL-backed sessions

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-011
- **Acceptance criteria:**
  1. The session token is 32 random bytes (base64url); the database stores only `HMAC-SHA256(SESSION_SECRET, token)` as the session ID.
  2. A session is valid only while `expires_at > now()` and the user is active; `last_seen_at` is updated on use.
  3. The session row stores IP and the first 300 characters of the browser identification string sent by the client.

#### FR-012 CSRF double-submit protection

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-011
- **Acceptance criteria:**
  1. Every non-GET/HEAD/OPTIONS request to a protected route must send `X-CSRF-Token` equal to the session's CSRF token (constant-time comparison).
  2. A missing or wrong header returns `403 CSRF_INVALID` before the permission check and before any handler runs.
  3. The web client reads `sp_csrf` and sends the header on mutations only.

#### FR-013 Per-email progressive login backoff

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-012
- **Acceptance criteria:**
  1. Attempts are counted per email regardless of source IP. Each attempt is **reserved** synchronously (check and count in one step, before any database or hashing work) and counts as a failure unless the login succeeds. The first `LOGIN_MAX_ATTEMPTS` (5) attempts carry no delay.
  2. From the 5th failed attempt, the next attempt for that email is refused for `LOGIN_BACKOFF_BASE_SECONDS × 2^(failures − 5)` seconds (30 s, 60 s, 120 s …), capped at `LOGIN_WINDOW_MINUTES` (15 min).
  3. Failure history decays after 4 × the login window (60 min) without a new failure; a successful login clears it.
  4. A refused attempt returns `429 RATE_LIMITED` with `details.retryAfterSeconds` (≥ 1) and a `Retry-After` header, and does not touch the password hash.
  5. Because reservation happens before any I/O, 20 concurrent bad logins for one account let at most `LOGIN_MAX_ATTEMPTS` through to password verification; the rest get `429`.
  6. All limits are checked before anything is counted, so an attempt refused by the IP limits does not add to the account's backoff.
  7. The bounded per-email store (NFR-027) is authoritative; ordinary failures never touch the count-min sketch (ADR-0020). Only an **active** entry that has to be force-evicted is absorbed into a fixed-size sketch keyed by `HMAC(SESSION_SECRET, email)`. The sketch is read only for emails that have no entry in the store, so: an evicted active lock-out is still enforced after a flood of new keys; a successful login's cleared entry always wins over the sketch, even after an earlier eviction; and failures spread across many emails never lock out an email that was never tried.
  8. If any sketch row is more than 50% occupied, the sketch is ignored for reads, the alert `throttle_sketch_saturated` is logged and `stats().saturatedReads` is incremented. This is a documented residual risk: once saturated, an evicted lock-out can lapse early.

#### FR-014 Per-IP password-spraying limiter

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-012
- **Acceptance criteria:**
  1. Login attempts are also counted per **normalised** client IP across all emails in a fixed window of `LOGIN_WINDOW_MINUTES` (15 min). Normalisation collapses IPv4-mapped IPv6 (`::ffff:203.0.113.7` → `203.0.113.7`) and reduces IPv6 addresses to their /64 prefix.
  2. When an IP reaches `LOGIN_IP_MAX_ATTEMPTS` (50) counted attempts in the window, further logins from it (for any email) return `429 RATE_LIMITED` until the window ends.
  3. A successful login gives back only its own reserved slot; it does **not** reset the IP window, so failures already counted remain.
  4. One normalised IP (IPv4 address or IPv6 /64) may try at most `LOGIN_IP_MAX_EMAILS` (20) distinct emails per window; an attempt for a 21st new email returns `429` until the window ends (emails already tried in the window remain allowed, subject to the other limits).
  5. For IPv6, the enclosing /48 may try at most 4 × `LOGIN_IP_MAX_EMAILS` (80) distinct emails per window across all its /64s, so rotating /64 prefixes within one site does not bypass the cap.

#### FR-015 Registration limiter

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-012
- **Acceptance criteria:**
  1. Every registration attempt (successful or duplicate) counts against the client IP.
  2. After `REGISTER_IP_MAX_ATTEMPTS` (10) attempts in a 60-minute window, registration returns `429 RATE_LIMITED` with `Retry-After`.

#### FR-016 Reverse-proxy trust (`TRUST_PROXY`)

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-012
- **Acceptance criteria:**
  1. `TRUST_PROXY` accepts `false` (default), a hop count of 1–2 digits (e.g. `1`), or a comma-separated list of IPv4/IPv6 addresses or CIDRs.
  2. `true` and malformed values are rejected at start-up; trust is never derived from `NODE_ENV`. In production the variable must be set explicitly (FR-001); elsewhere it defaults to `false`.
  3. With `false`, rotating `X-Forwarded-For` does not change the client IP used by the throttles; with `1`, the address added by the nearest proxy is used.

#### FR-017 Role-based access control

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-013
- **Acceptance criteria:**
  1. Roles are `owner`, `admin`, `manager`, `operator`, `viewer`, each granting a strictly larger permission set than the next:
     - `viewer`: `topology:read`, `catalog:read`, `inventory:read`, `allocation:read`;
     - `operator`: + `inventory:receive`, `inventory:move`;
     - `manager`: + `inventory:adjust`, `allocation:write`, `catalog:write`, `audit:read`;
     - `admin`/`owner`: + `topology:write`, `inventory:verify`, `users:manage`.
  2. Routes declare a permission; handlers never check role names. No session → `401 UNAUTHENTICATED`; missing permission → `403 FORBIDDEN`.

#### FR-018 Audit write path

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-014
- **Acceptance criteria:**
  1. Audit rows (`organization_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `request_id`, `metadata`, `occurred_at`) are written for: `organization.registered`, `auth.register_duplicate`, `auth.login`, `auth.login_failed`, `warehouse.created`, `sku.created`, `inventory.received`, `inventory.moved`, `inventory.adjusted`, `allocation.created`, `allocation.released`.
  2. For inventory and allocation changes the audit row is written in the same transaction as the change, so neither exists without the other.

#### FR-019 Tenant isolation

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-013, SP-020
- **Acceptance criteria:**
  1. Every query is scoped by the session's `organization_id`; a warehouse, SKU, lot, bin or allocation of another organisation returns `404 NOT_FOUND`, and list endpoints return only own records.
  2. Zones and bins reference their warehouse through composite `(organization_id, warehouse_id)` / `(warehouse_id, zone_id)` foreign keys.

#### FR-020 Email-verified signup

- **Priority:** Should · **Status:** pending · **Tickets:** SP-009
- **Acceptance criteria:**
  1. Registration writes a single-use verification token (expires in 24 h) to the local outbox; the account cannot log in until `POST /auth/verify-email` succeeds.
  2. The registration response remains the same 202 for new and existing emails.

#### FR-021 User invitations and management

- **Priority:** Must · **Status:** pending · **Tickets:** SP-015
- **Acceptance criteria:**
  1. Users with `users:manage` can invite by email and role (`POST /users/invitations`); the invite expires in 7 days and is single-use.
  2. `GET /users` lists members; `PATCH /users/:userId` changes role or deactivates; deactivation invalidates the user's sessions immediately.
  3. The last active owner cannot be demoted or deactivated.

#### FR-022 Password reset

- **Priority:** Must · **Status:** pending · **Tickets:** SP-017
- **Acceptance criteria:**
  1. `POST /auth/password-reset` always returns 202; for a known email a 30-minute single-use token is written to the outbox.
  2. Completing a reset revokes all existing sessions of that user.

#### FR-023 Custom role editor

- **Priority:** Could · **Status:** pending · **Tickets:** SP-016
- **Acceptance criteria:**
  1. Admins can create named roles from the permission list; built-in roles cannot be edited.
  2. Route checks continue to use permissions only, so no handler changes are needed.

#### FR-024 3PL client accounts and client-scoped inventory

- **Priority:** Must · **Status:** pending · **Tickets:** SP-018
- **Acceptance criteria:**
  1. SKUs, lots, ledger movements and balances carry a `client_id`; one warehouse can hold stock for many clients.
  2. A client-scoped user sees only that client's SKUs, balances, orders and reports; cross-client access returns 404.
  3. Allocation never draws one client's stock for another client's order.

#### FR-025 Audit log browser and export

- **Priority:** Should · **Status:** pending · **Tickets:** SP-019
- **Acceptance criteria:**
  1. `GET /audit-events` (permission `audit:read`) filters by actor, action, entity and time range with keyset pagination.
  2. CSV export of a filtered range is available for compliance reviews.

### E03 — Warehouse topology

#### FR-026 Warehouses with canonical time zones

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-020
- **Acceptance criteria:**
  1. `POST /api/v1/warehouses` (`topology:write`) takes `code` (1–32 characters of letters, digits, `.`, `_`, `-`; stored upper-case, unique per organisation), `name` and `timezone` (default `UTC`).
  2. The time zone is resolved to its canonical IANA name (`europe/london` → `Europe/London`); unknown zones (e.g. `Mars/Olympus`) return `400 VALIDATION_FAILED` "Unknown IANA time zone".
  3. "Today" for expiry and allocation decisions is the calendar date in the warehouse time zone.
  4. `GET /warehouses` lists by code; `GET /warehouses/:id` returns one or `404`.

#### FR-027 Typed zones

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-020
- **Acceptance criteria:**
  1. Zones belong to a warehouse, have a code unique within it, and a type from `RECEIVING`, `STORAGE`, `PICK`, `STAGING`, `SHIPPING`, `QUARANTINE`.
  2. Only `STORAGE` and `PICK` zones are allocatable (FR-060).

#### FR-028 Bin code validation

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-020
- **Acceptance criteria:**
  1. Structured codes follow `ZONE-AA-RR-L-P`: zone 1–4 upper-case alphanumerics starting with a letter, aisle `01`–`99`, rack `01`–`99`, level `0`–`9` (0 = floor), position `A`–`Z`; e.g. `A-03-12-2-B`.
  2. Free-form codes (`RCV01`, `DOCK1`, `QCAGE1`) of 2–16 upper-case alphanumerics starting with a letter are accepted for staging, dock and cage locations.
  3. Input is trimmed and upper-cased; aisle or rack `00` and any other format return `400 INVALID_BIN_CODE`. Codes are unique per warehouse.

#### FR-029 Default serpentine pick sequence

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-020
- **Acceptance criteria:**
  1. If `pickSequence` is omitted, structured bins get `aisle × 100000 + rackOrder × 1000 + level × 100 + positionIndex`, where `rackOrder` is the rack on odd aisles and `100 − rack` on even aisles (S-shape walk); free-form bins get 0.
  2. An explicit `pickSequence` (0 – 2,000,000,000) overrides the default.
  3. Bin lists, balances and allocation picks are ordered by pick sequence, then bin code.

#### FR-030 Bin capacity attributes

- **Priority:** Should · **Status:** implemented (recording only; enforcement is FR-032) · **Tickets:** SP-020
- **Acceptance criteria:**
  1. Bins accept optional `maxWeightGrams` (1 – 100,000,000) and `maxVolumeCm3` (1 – 1,000,000,000), stored as positive integers.
  2. Values are returned on bin reads; they are not yet checked on receipts or moves.

#### FR-031 Topology bulk import

- **Priority:** Should · **Status:** pending · **Tickets:** SP-021
- **Acceptance criteria:**
  1. `POST /warehouses/:id/bins/import` accepts a CSV of zone, bin code, pick sequence and capacity; the whole file is validated first and applied in one transaction.
  2. The response lists every rejected row with line number and reason; nothing is written if any row fails.

#### FR-032 Bin capacity enforcement

- **Priority:** Should · **Status:** pending · **Tickets:** SP-022
- **Acceptance criteria:**
  1. Receipts, moves and putaway into a bin with limits compute resulting weight and volume from item attributes (FR-040); exceeding either returns `409 BIN_CAPACITY_EXCEEDED` with the limiting dimension.
  2. Bins without limits are unconstrained.

#### FR-033 Warehouse, zone and bin update and deactivation

- **Priority:** Must · **Status:** pending · **Tickets:** SP-024
- **Acceptance criteria:**
  1. `PATCH /warehouses/:id` and `PATCH /warehouses/:id/bins/:binId` update names, pick sequence and limits.
  2. A bin with on-hand stock cannot be deactivated; a deactivated bin is rejected for receipts and moves (`409 BIN_INACTIVE`, already enforced by FR-048) and excluded from allocation.

#### FR-034 Warehouse map visualisation

- **Priority:** Could · **Status:** pending · **Tickets:** SP-023
- **Acceptance criteria:**
  1. `GET /warehouses/:id/map` returns an SVG layout of zones, aisles and bins derived from structured bin codes.
  2. Bins are shaded by fill level and expiry exposure.

### E04 — Catalogue & UoM

#### FR-035 SKU creation with tracking flags

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-030, SP-031
- **Acceptance criteria:**
  1. `POST /api/v1/skus` (`catalog:write`) takes `code` (unique per organisation, upper-cased), `description` (1–240), `baseUom` (default `EA`), `uomLevels` (≤ 6), `lotTracked`, `expiryTracked`, `defaultStrategy` (`FEFO` | `FIFO` | `LIFO`, default `FIFO`).
  2. `expiryTracked: true` without `lotTracked: true` returns `400 VALIDATION_FAILED` ("Expiry tracking requires lot tracking"); the database enforces the same rule with a CHECK constraint.
  3. `GET /skus?search=` (≤ 200 results, by code) and `GET /skus/:id` return SKUs with their normalised ladder.

#### FR-036 Nested UoM ladders

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-030
- **Acceptance criteria:**
  1. Unit codes match `^[A-Z][A-Z0-9]{0,9}$`; each pack level has an integer `factor ≥ 2` base units; codes are unique within the ladder, including the base unit.
  2. Levels are sorted by factor and each must be a whole multiple of the level below (CS 12, PL 480 is valid; CS 12, PL 100 returns `400 INVALID_UOM_LADDER`).
  3. A base-only ladder (no levels) is valid.

#### FR-037 Exact UoM conversion

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-030
- **Acceptance criteria:**
  1. Quantities are positive whole numbers ≤ 10^12; zero, negative, fractional or overflowing values return `400 INVALID_QUANTITY`.
  2. Conversion to base units multiplies by the level factor (5 CS = 60 EA when CS = 12); an undefined unit returns `400 INVALID_UOM` with the allowed units in `details`.
  3. Conversion between levels that would be fractional (18 EA → CS) returns `NON_INTEGRAL_CONVERSION`; nothing is ever rounded.

#### FR-038 Largest-first quantity breakdown

- **Priority:** Should · **Status:** implemented · **Tickets:** SP-030
- **Acceptance criteria:**
  1. A base quantity is decomposed into the largest pack levels first (1000 EA with CS 12 / PL 480 → `2 PL + 3 CS + 4 EA`); empty levels are omitted; 0 renders as `0 EA`.
  2. The breakdown always sums back to the original quantity and is returned as `quantityDescription` on receipts and shown in the stock table.

#### FR-039 Lot register

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-031
- **Acceptance criteria:**
  1. Lots are unique per `(sku, lot_code)` and record `expiry_date` (nullable), `received_at` (first receipt) and `on_hold`.
  2. `GET /skus/:id/lots` lists a SKU's lots ordered by expiry (nulls last), then receipt time.

#### FR-040 Item attributes

- **Priority:** Should · **Status:** pending · **Tickets:** SP-034
- **Acceptance criteria:**
  1. Each UoM level can carry length, width, height (mm) and weight (g); SKUs carry hazmat class and temperature class.
  2. Attributes feed capacity checks (FR-032), putaway (FR-076) and cartonization (FR-088).

#### FR-041 SKU catalogue import/export

- **Priority:** Should · **Status:** pending · **Tickets:** SP-033
- **Acceptance criteria:**
  1. `POST /skus/import` accepts CSV including ladders; all rows validated before any are written.
  2. Export produces the same CSV format so a round trip is lossless.

#### FR-042 SKU update and UoM ladder versioning

- **Priority:** Must · **Status:** pending · **Tickets:** SP-035
- **Acceptance criteria:**
  1. `PATCH /skus/:id` updates description and default strategy freely.
  2. Ladder changes create a new version; historical movements keep base-unit quantities, and a pack factor cannot change while open allocations or ASNs reference it.

#### FR-043 Serial number tracking

- **Priority:** Could · **Status:** pending · **Tickets:** SP-032
- **Acceptance criteria:**
  1. Serial-tracked SKUs require one serial per base unit on receipt, move and ship; duplicates within a SKU are rejected.
  2. `GET /skus/:id/serials` returns each serial's current bin and movement history.

### E05 — Inventory ledger

#### FR-044 Receipts in any pack unit

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040
- **Acceptance criteria:**
  1. `POST /api/v1/inventory/receipts` (`inventory:receive`) with `warehouseId`, `binId`, `skuId`, `quantity`, optional `uom` (default base unit), `lotCode`, `expiryDate`, `reference` (≤ 64) appends one `RECEIPT` movement to the bin.
  2. The quantity is converted to base units (2 CS with CS = 12 → 24 EA) before it is stored.
  3. The `201` response contains `movementId`, `correlationId`, `lot`, base `quantity`, `quantityDescription` and the updated `balance`.
  4. Unknown warehouse, bin (in that warehouse) or SKU returns `404`.

#### FR-045 Lot and expiry rules on receipt

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-031, SP-040
- **Acceptance criteria:**
  1. `lotCode` is required for lot-tracked SKUs and rejected for others; `expiryDate` (`YYYY-MM-DD`, a real calendar date) is required for expiry-tracked SKUs and rejected for others — each with `400 VALIDATION_FAILED` naming the field.
  2. Lot codes are upper-cased. A receipt into an existing lot reuses it; if the stated expiry differs from the recorded one the receipt fails with `409 LOT_EXPIRY_MISMATCH` (`details.recorded`, `details.received`).
  3. Untracked SKUs receive into a system lot `AUTO-YYYYMMDD` for the receipt date in the warehouse time zone, so FIFO/LIFO still have an age to sort by.

#### FR-046 Bin-to-bin moves

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040
- **Acceptance criteria:**
  1. `POST /api/v1/inventory/moves` (`inventory:move`) moves a quantity (any defined unit) of one lot between two bins of the same warehouse as a single `MOVE` movement.
  2. Identical source and destination return `400 VALIDATION_FAILED`.
  3. Only available units may move: moving more than `on_hand − allocated` in the source returns `409 INSUFFICIENT_AVAILABLE` with `requested` and `available`; allocated units therefore stay in place.
  4. The lot must belong to the SKU, otherwise `404`.

#### FR-047 Reason-coded adjustments

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040
- **Acceptance criteria:**
  1. `POST /api/v1/inventory/adjustments` (`inventory:adjust`, manager and above) takes a non-zero integer `delta` in base units, a `reason` from `DAMAGED`, `FOUND`, `LOST`, `EXPIRED`, `CORRECTION`, and an optional `note` (≤ 240).
  2. Positive deltas append `ADJUST_IN`, negative deltas `ADJUST_OUT`; reason and note are stored on the movement.
  3. A negative delta larger than available stock returns `409 INSUFFICIENT_AVAILABLE`; on-hand never goes negative and never drops below allocated.

#### FR-048 Inactive bin guard

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040
- **Acceptance criteria:**
  1. Receipts, moves (either side) and adjustments against an inactive bin return `409 BIN_INACTIVE`.
  2. Inactive bins are excluded from allocation candidates.

#### FR-049 Append-only ledger

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040
- **Acceptance criteria:**
  1. A `BEFORE UPDATE OR DELETE` trigger on `inventory_movements` raises "inventory_movements is append-only" for every row; the change is rolled back.
  2. Corrections are always new compensating movements (`ADJUST_*`, `DEALLOCATE`).
  3. Movement quantities are positive; direction comes from the type and `from_bin_id`/`to_bin_id` (CHECKs: at least one bin set, bins distinct).

#### FR-050 Movement metadata and history

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040
- **Acceptance criteria:**
  1. Each movement records type, SKU, lot, bins, quantity, reason, reference, actor, `occurred_at` and a `correlation_id` shared by all movements of one command (e.g. every `ALLOCATE` of one order).
  2. `GET /api/v1/inventory/movements?warehouseId=` (optional `skuId`, `binId` matching either side, `limit` 1–200, default 50) returns movements newest first with SKU, lot and bin codes.
  3. Keyset pagination: `meta.nextCursor` is the last ID when a full page is returned; passing it as `before` returns the next older page with no overlap.

#### FR-051 Transactional on-hand projection

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-041
- **Acceptance criteria:**
  1. Each movement updates `stock_balances` (keyed by bin, SKU, lot) in the same transaction as the append; the affected rows are locked `FOR UPDATE` in sorted key order.
  2. The shared domain rejects any effect that would make on-hand negative, allocate more than available, or release more than allocated (`INSUFFICIENT_AVAILABLE` / `INSUFFICIENT_ALLOCATED`, 409).
  3. Database CHECKs `on_hand ≥ 0`, `allocated ≥ 0` and `allocated ≤ on_hand` back this up (`409 CONSTRAINT_VIOLATION`).
  4. Each balance row records `version` and `last_movement_id`.

#### FR-052 Stock-on-hand query

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-041
- **Acceptance criteria:**
  1. `GET /api/v1/inventory/balances?warehouseId=` (`inventory:read`), optionally filtered by `skuId` and `binId`, returns on-hand, allocated and available per bin/SKU/lot with codes and expiry.
  2. Rows with zero on-hand are hidden unless `includeEmpty=true`; `limit` is 1–200 (default 50); `meta` includes `count` and `limit`.
  3. Results are ordered by bin pick sequence, bin code, SKU code, expiry (nulls last), lot code.

#### FR-053 Projection verification by replay

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-041
- **Acceptance criteria:**
  1. `GET /api/v1/inventory/projection/verify` (`inventory:verify`, admin/owner) folds the organisation's full ledger in ID order and compares it with stored balances.
  2. Ledger and balances are read in a single `REPEATABLE READ READ ONLY` transaction, so both come from the same snapshot and writes made during verification cannot show up as false drift.
  3. The response is `{ consistent, movementCount, balanceCount, mismatches[] }`; each mismatch gives the key and expected versus actual on-hand and allocated; zero rows on either side are ignored.
  4. Drift, missing rows and phantom rows are all reported.

#### FR-054 Stock-on-hand screen with receive and move forms

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-061
- **Acceptance criteria:**
  1. The _Stock on hand_ page shows balances by bin with warehouse, SKU and bin filters, quantities with pack breakdown, and an expiry cell flagged _danger_ when expired and _warn_ within 14 days.
  2. The receive form asks for lot and expiry only when the selected SKU tracks them and lets the user choose any unit of the SKU's ladder.
  3. A _Move_ action appears only on rows with available stock; the move form excludes the source bin and shows API errors (e.g. insufficient stock) inline.

#### FR-055 Inventory status and holds

- **Priority:** Must · **Status:** pending · **Tickets:** SP-042
- **Acceptance criteria:**
  1. `POST /inventory/holds` places a lot, bin or bin/lot on hold with status `QUARANTINE`, `DAMAGED` or `QA` and a reason; release requires `inventory:adjust`.
  2. Held stock stays on hand but is never allocated (the planner already excludes `on_hold` lots with reason `ON_HOLD`).

#### FR-056 Point-in-time stock query

- **Priority:** Should · **Status:** pending · **Tickets:** SP-043
- **Acceptance criteria:**
  1. `GET /inventory/balances/as-of?at=<timestamp>` returns balances as they were at that instant, computed from the nearest snapshot plus ledger replay.
  2. For any timestamp, the result equals a full replay up to that instant.

#### FR-057 Ledger snapshots and projection compaction

- **Priority:** Should · **Status:** pending · **Tickets:** SP-044
- **Acceptance criteria:**
  1. `POST /inventory/snapshots` stores balances as of a movement ID; verification and as-of queries replay only movements after the snapshot.
  2. Verification time is bounded by movements since the last snapshot, not total ledger size.

#### FR-058 Adjustment approval workflow

- **Priority:** Should · **Status:** pending · **Tickets:** SP-045
- **Acceptance criteria:**
  1. Adjustments whose absolute value or value exceeds a configured threshold are created as _pending approval_ and post to the ledger only once approved by a different user.
  2. Rejected adjustments are retained with the approver and reason.

### E06 — Allocation

#### FR-059 FEFO, FIFO and LIFO strategies

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-050
- **Acceptance criteria:**
  1. **FEFO** consumes the earliest expiry first, lots without expiry last; ties by earliest receipt, then lot code.
  2. **FIFO** consumes the earliest `received_at` first regardless of expiry; **LIFO** the latest first; ties by lot code.
  3. The strategy is the request's `strategy` if given, otherwise each SKU's `defaultStrategy`; the strategy used is stored on each allocation line.

#### FR-060 Allocation eligibility

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-050, SP-051
- **Acceptance criteria:**
  1. Lots with `expiry_date ≤ today` (warehouse time zone) are excluded with reason `EXPIRED` under every strategy, including FIFO and LIFO.
  2. With `minShelfLifeDays = N` (0–3650), lots expiring before `today + N` are excluded (`SHORT_SHELF_LIFE`); a lot expiring exactly on `today + N` is eligible.
  3. Lots on hold (`ON_HOLD`) and rows without available stock (`NO_AVAILABLE`) are excluded.
  4. Only stock in active bins of `STORAGE` and `PICK` zones is a candidate; receiving, staging, shipping and quarantine stock is never promised.

#### FR-061 Pick-touch minimisation

- **Priority:** Should · **Status:** implemented · **Tickets:** SP-050
- **Acceptance criteria:**
  1. Within a group of equally ranked lots, if one bin can cover the whole remainder, the **smallest** such bin is chosen (best fit, keeping larger quantities intact).
  2. Otherwise bins are drained largest first.
  3. Ties are broken by pick sequence, then bin code.

#### FR-062 Partial allocation and ship-complete

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-050, SP-051
- **Acceptance criteria:**
  1. With `shipComplete: false` (default) each line may be partly filled; the allocation is stored as `PARTIAL` with per-line `requested` and `allocated`.
  2. With `shipComplete: true`, if any line is short, nothing is reserved for any line.
  3. When nothing can be reserved, the API returns `409 INSUFFICIENT_STOCK` with per-line `lineNo`, `skuId`, `requested`, `shortfall` and the count of excluded candidates, and writes nothing.
  4. A fully covered order is stored as `ALLOCATED`.

#### FR-063 Multi-line orders in any unit

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-050, SP-051
- **Acceptance criteria:**
  1. `POST /api/v1/allocations` (`allocation:write`) takes `warehouseId`, `orderRef` (1–64), optional `strategy`, `shipComplete`, `minShelfLifeDays` and 1–200 lines of `skuId`, `quantity`, optional `uom`.
  2. Line quantities are converted to base units per SKU ladder (1 CS → 12 EA).
  3. Lines of the same SKU draw from a shared pool, so a later line can never reuse units planned for an earlier line.
  4. Unknown SKUs return `404` listing the missing IDs.

#### FR-064 Concurrency-safe allocation

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-051
- **Acceptance criteria:**
  1. In one transaction the API locks all candidate balance rows for the order's SKUs with a **single** `SELECT … ORDER BY sku_id, id FOR UPDATE OF stock_balances`, plans in pure code against that locked snapshot, then writes the allocation, lines, picks and one `ALLOCATE` movement per pick.
  2. Because every allocator takes locks in the same order, concurrent allocators queue rather than deadlock; a waiter re-reads committed availability after the lock is released.
  3. 12 concurrent ship-complete orders of 5 units against 39 available units produce exactly 7 successes and 5 `409`s, 35 units allocated, `allocated ≤ on_hand` in every row, and a consistent projection.

#### FR-065 One open allocation per order reference

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-051
- **Acceptance criteria:**
  1. A partial unique index allows only one non-`RELEASED` allocation per `(organisation, warehouse, orderRef)`; a duplicate returns `409 ALREADY_EXISTS`.
  2. After release, the same order reference can be allocated again.

#### FR-066 Allocation list and detail

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-051
- **Acceptance criteria:**
  1. `GET /api/v1/allocations?warehouseId=` (`allocation:read`) lists allocations newest first (`limit` 1–200).
  2. `GET /api/v1/allocations/:id` returns the header (status, ship-complete, shelf life, correlation ID, timestamps) and lines with SKU code, strategy, requested, allocated and picks (bin code, lot code, expiry, quantity) in pick-sequence order.

#### FR-067 Allocation release

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-055
- **Acceptance criteria:**
  1. `POST /api/v1/allocations/:id/release` locks the allocation, appends one `DEALLOCATE` movement per pick under a new correlation ID, sets status `RELEASED` and `released_at`, and audits `allocation.released`.
  2. Released units become available again immediately.
  3. Releasing twice returns `409 ALREADY_RELEASED`.

#### FR-068 Allocation screen

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-061
- **Acceptance criteria:**
  1. The _Allocations_ page provides a form with order reference, lines, strategy override, minimum shelf life and ship-complete, and shows shortfall errors returned by the API.
  2. It lists allocations, shows picks for the selected one, and offers _Release_.

#### FR-069 Allocation rules per client and SKU class

- **Priority:** Should · **Status:** pending · **Tickets:** SP-052
- **Acceptance criteria:**
  1. Rules keyed by client and SKU class set strategy, minimum shelf life and ship-complete defaults; the most specific rule wins over SKU defaults and request values cannot weaken a client's minimum shelf life.

#### FR-070 Pick-face versus reserve aware allocation

- **Priority:** Should · **Status:** pending · **Tickets:** SP-053
- **Acceptance criteria:**
  1. Full-case and full-pallet quantities are allocated from reserve; remainders from pick faces, using the UoM breakdown.
  2. Pick faces are never drained below their replenishment minimum by full-case quantities.

#### FR-071 Backorders and allocation retry

- **Priority:** Should · **Status:** pending · **Tickets:** SP-054
- **Acceptance criteria:**
  1. Unallocated quantities on order lines become backorders that are retried after receipts, releases and adjustments that add available stock, oldest order first.

### E07 — Inbound & receiving

#### FR-072 ASN creation and import

- **Priority:** Must · **Status:** pending · **Tickets:** SP-070
- **Acceptance criteria:**
  1. `POST /asns` creates an advance shipping notice with supplier, expected arrival, lines (SKU, quantity, unit, optional lot and expiry); CSV import is supported.
  2. `GET /asns` filters by status (`EXPECTED`, `RECEIVING`, `CLOSED`) and arrival date.

#### FR-073 Receiving against an ASN with discrepancy handling

- **Priority:** Must · **Status:** pending · **Tickets:** SP-071
- **Acceptance criteria:**
  1. `POST /asns/:id/receipts` posts `RECEIPT` movements into a receiving bin and accumulates received quantities per line.
  2. Over-receipt beyond a tolerance, unexpected SKUs and lot/expiry mismatches are recorded as discrepancies with reason.
  3. `POST /asns/:id/close` produces a discrepancy report (short, over, unexpected, damaged) per line.

#### FR-074 Mobile receiving scanner flow

- **Priority:** Should · **Status:** pending · **Tickets:** SP-072
- **Acceptance criteria:**
  1. A phone-sized flow scans ASN, SKU (or GTIN), lot and expiry and confirms quantity in a chosen pack unit in ≤ 4 taps per line.

#### FR-075 Quality inspection and quarantine on receipt

- **Priority:** Should · **Status:** pending · **Tickets:** SP-073
- **Acceptance criteria:**
  1. SKUs flagged for inspection are received into a `QUARANTINE` zone with a QA hold; `POST /inspections` records pass/fail per lot and releases or keeps the hold.

### E08 — Putaway & slotting

#### FR-076 Directed putaway rules engine

- **Priority:** Must · **Status:** pending · **Tickets:** SP-080
- **Acceptance criteria:**
  1. `POST /putaway/suggestions` returns a ranked list of destination bins honouring zone rules (temperature, hazmat), capacity (FR-032), consolidation with the same SKU/lot, and proximity to the pick face.
  2. No suggested bin violates capacity or zone compatibility.

#### FR-077 Putaway task execution and confirmation

- **Priority:** Must · **Status:** pending · **Tickets:** SP-081
- **Acceptance criteria:**
  1. Putaway tasks are listed (`GET /putaway/tasks`) and confirmed (`POST /putaway/tasks/:id/confirm`) by scanning the destination bin; confirmation posts a `MOVE` from receiving to the bin.
  2. Confirming to a different bin than suggested requires a reason.

#### FR-078 Velocity-based (ABC) slotting recommendations

- **Priority:** Could · **Status:** pending · **Tickets:** SP-082
- **Acceptance criteria:**
  1. `GET /slotting/recommendations` classifies SKUs A/B/C by picks over a trailing window and proposes moves of A items to the lowest pick-sequence pick faces, with expected travel saving.

### E09 — Outbound orders & waves

#### FR-079 Outbound order intake

- **Priority:** Must · **Status:** pending · **Tickets:** SP-090
- **Acceptance criteria:**
  1. `POST /orders` (JSON) and CSV import create orders with ship-to, carrier, service level, requested ship date and lines; order references are unique per client.
  2. `GET /orders` filters by status, carrier and ship date.

#### FR-080 Order lifecycle state machine

- **Priority:** Must · **Status:** pending · **Tickets:** SP-091
- **Acceptance criteria:**
  1. Orders move through `NEW → ALLOCATED | PARTIAL → RELEASED → PICKING → PICKED → PACKED → SHIPPED`, with `CANCELLED` allowed before `PICKED`; illegal transitions return `409`.
  2. `POST /orders/:id/cancel` releases any allocation via compensating movements.

#### FR-081 Wave planning by carrier cut-off and zone

- **Priority:** Must · **Status:** pending · **Tickets:** SP-092
- **Acceptance criteria:**
  1. `POST /waves` groups allocated orders by carrier cut-off time and zone, limited by a maximum line count per wave; `GET /waves` lists planned waves.
  2. Orders with the earliest cut-off are planned first.

#### FR-082 Wave release and task creation

- **Priority:** Must · **Status:** pending · **Tickets:** SP-093
- **Acceptance criteria:**
  1. `POST /waves/:id/release` turns allocation picks into pick tasks grouped by zone, ordered by pick path, and marks orders `RELEASED`; a released wave cannot be re-released.

### E10 — Picking & pick paths

#### FR-083 Pick path optimisation

- **Priority:** Must · **Status:** pending · **Tickets:** SP-100
- **Acceptance criteria:**
  1. `POST /pick-paths` sequences a set of bins using S-shape, largest-gap and a 2-opt improvement over aisle geometry, returning the order and estimated distance.
  2. On benchmark orders the result is never longer than the serpentine pick-sequence order and is ≥ 15% shorter on median.

#### FR-084 Pick task execution and short picks

- **Priority:** Must · **Status:** pending · **Tickets:** SP-101
- **Acceptance criteria:**
  1. `POST /pick-tasks/:id/confirm` with scanned bin, SKU and lot moves stock from the bin to a staging location and consumes the allocation.
  2. `POST /pick-tasks/:id/short` records the found quantity, posts an adjustment for the missing units with reason `LOST` pending count, and re-allocates the shortfall from other bins where possible.

#### FR-085 Batch and cluster picking

- **Priority:** Should · **Status:** pending · **Tickets:** SP-102
- **Acceptance criteria:**
  1. Multiple orders can be picked in one trip into separate totes; the path covers all bins once and each pick is attributed to its order.

#### FR-086 Picker mobile UI

- **Priority:** Must · **Status:** pending · **Tickets:** SP-103
- **Acceptance criteria:**
  1. A phone-sized UI shows one pick at a time (bin, SKU, lot, quantity as pack breakdown), requires scan confirmation and offers _Short_.

### E11 — Packing & cartonization

#### FR-087 Carton type catalogue

- **Priority:** Must · **Status:** pending · **Tickets:** SP-110
- **Acceptance criteria:**
  1. `GET /carton-types` lists cartons with inner dimensions (mm), tare weight and maximum gross weight; codes unique per organisation.

#### FR-088 3D cartonization heuristic

- **Priority:** Must · **Status:** pending · **Tickets:** SP-111
- **Acceptance criteria:**
  1. `POST /cartonization` packs an order's items into the fewest, smallest cartons using a 3D first-fit-decreasing heuristic with item rotations; no carton exceeds its weight limit and no item overlaps or protrudes.
  2. Average volume utilisation on the benchmark set is ≥ 75%.

#### FR-089 Pack station with scan verification

- **Priority:** Must · **Status:** pending · **Tickets:** SP-112
- **Acceptance criteria:**
  1. `POST /pack-sessions` opens a session per order; each item scan is checked against the picked lines; a wrong or extra item is refused; the session closes only when every unit is packed.

### E12 — Shipping

#### FR-090 Shipments and manifests

- **Priority:** Must · **Status:** pending · **Tickets:** SP-120
- **Acceptance criteria:**
  1. Packed cartons form shipments (`GET /shipments`); a manifest per carrier and day (`GET /manifests/:id`) lists shipments, cartons, weights and tracking references.

#### FR-091 Local carrier rate tables

- **Priority:** Should · **Status:** pending · **Tickets:** SP-121
- **Acceptance criteria:**
  1. `GET /carrier-rates` returns rates by carrier, service, zone and weight break, including dimensional-weight divisor; rates are maintained locally with no external calls.

#### FR-092 Shipping documents

- **Priority:** Should · **Status:** pending · **Tickets:** SP-122
- **Acceptance criteria:**
  1. A packing list per shipment and a bill of lading per manifest are rendered as printable documents containing lots and serials where tracked.

#### FR-093 Ship confirmation and inventory decrement

- **Priority:** Must · **Status:** pending · **Tickets:** SP-123
- **Acceptance criteria:**
  1. `POST /shipments/:id/confirm` posts outbound movements that reduce on-hand and allocated together for every shipped unit, marks orders `SHIPPED`, and is idempotent.

### E13 — Cycle counting

#### FR-094 Cycle count planning

- **Priority:** Must · **Status:** pending · **Tickets:** SP-130
- **Acceptance criteria:**
  1. `POST /cycle-counts` creates count plans by ABC frequency (e.g. A monthly, B quarterly, C yearly), by zone or by exception (negative available, recent short picks); `GET /cycle-counts` lists them.

#### FR-095 Blind count execution

- **Priority:** Must · **Status:** pending · **Tickets:** SP-131
- **Acceptance criteria:**
  1. Counters see bin and SKU but not the expected quantity; `POST /cycle-counts/:id/results` records counted quantities per lot.
  2. Movements on a bin during counting are flagged so the variance accounts for them.

#### FR-096 Variance approval and adjustment posting

- **Priority:** Must · **Status:** pending · **Tickets:** SP-132
- **Acceptance criteria:**
  1. `POST /cycle-counts/:id/approve` posts `ADJUST_IN`/`ADJUST_OUT` movements with reason `CORRECTION` for approved variances; variances above threshold require a recount or a second approver.

### E14 — Replenishment

#### FR-097 Min/max replenishment rules

- **Priority:** Must · **Status:** pending · **Tickets:** SP-140
- **Acceptance criteria:**
  1. `GET /replenishment/rules` lists per pick-face rules with minimum, maximum and replenishment unit (e.g. CS).

#### FR-098 Replenishment tasks and execution

- **Priority:** Must · **Status:** pending · **Tickets:** SP-141
- **Acceptance criteria:**
  1. `POST /replenishment/run` creates tasks for faces where available ≤ minimum, sized to the largest whole number of replenishment units that does not exceed the maximum, sourced from reserve by FEFO; confirmation posts a `MOVE`.

#### FR-099 Demand-based replenishment

- **Priority:** Could · **Status:** pending · **Tickets:** SP-142
- **Acceptance criteria:**
  1. Before each wave release, faces that cannot cover the wave's allocated demand get replenishment tasks ahead of picking.

### E15 — Returns

#### FR-100 RMA authorisation

- **Priority:** Should · **Status:** pending · **Tickets:** SP-150
- **Acceptance criteria:**
  1. `POST /rmas` authorises a return against a shipped order line, quantity and reason; quantities cannot exceed what was shipped.

#### FR-101 Returns receiving and disposition

- **Priority:** Should · **Status:** pending · **Tickets:** SP-151
- **Acceptance criteria:**
  1. `POST /rmas/:id/receipts` receives returned units into a returns location and records disposition `RESTOCK`, `QUARANTINE` or `SCRAP`; restock moves to storage, scrap posts `ADJUST_OUT` with reason `DAMAGED`.

### E16 — Labels & handling units

#### FR-102 In-house Code128 barcode encoder

- **Priority:** Must · **Status:** pending · **Tickets:** SP-160
- **Acceptance criteria:**
  1. `POST /labels/barcode` encodes text into Code128 (automatic code set B/C selection, modulo-103 check digit) and returns SVG; output scans correctly on standard scanners.

#### FR-103 Label templates

- **Priority:** Must · **Status:** pending · **Tickets:** SP-161
- **Acceptance criteria:**
  1. Templates for bin (`GET /labels/bins/:binId`), LPN, carton and shipping labels render 4×6 in and 2×1 in sizes with human-readable text under each barcode.

#### FR-104 Licence plates and nested containers

- **Priority:** Should · **Status:** pending · **Tickets:** SP-162
- **Acceptance criteria:**
  1. Stock can be received, moved and picked as LPNs (pallet → case) so one scan moves all contents; LPN contents always equal the sum of their ledger balances.

### E17 — Reporting & billing

#### FR-105 Operations dashboard

- **Priority:** Should · **Status:** pending · **Tickets:** SP-170
- **Acceptance criteria:**
  1. `GET /dashboards/operations` shows inbound, putaway, pick and ship backlog and throughput per hour for today, refreshing at least every 60 s.

#### FR-106 Inventory reports

- **Priority:** Must · **Status:** pending · **Tickets:** SP-171
- **Acceptance criteria:**
  1. `GET /reports/inventory-aging` buckets on-hand by days since receipt (0–30, 31–60, 61–90, > 90); expiry exposure lists units expiring within 30/60/90 days; velocity ranks SKUs by units picked.

#### FR-107 Ledger CSV export

- **Priority:** Should · **Status:** pending · **Tickets:** SP-172
- **Acceptance criteria:**
  1. `GET /reports/ledger-export` streams movements for a warehouse and date range as CSV in ID order; totals reconcile with balances.

#### FR-108 Local outbox and in-app notifications

- **Priority:** Must · **Status:** pending · **Tickets:** SP-173
- **Acceptance criteria:**
  1. Emails (verification, reset, invitations) are written to an outbox table and delivered by a worker; `GET /notifications` returns in-app notifications for the user, newest first.

#### FR-109 3PL storage and handling billing

- **Priority:** Must · **Status:** pending · **Tickets:** SP-174
- **Acceptance criteria:**
  1. `GET /billing/storage` computes per-client storage charges (pallet- or bin-days from daily balances) and handling charges (receipt lines, picks, cartons shipped) for a period using client rate cards.
  2. Every charge line references the ledger movements or balances it was derived from.

### E18 — Operations & hardening

#### FR-110 Labour tracking and productivity

- **Priority:** Could · **Status:** pending · **Tickets:** SP-188
- **Acceptance criteria:**
  1. Task start/finish times per user produce units-per-hour by task type, compared against engineered standards.

#### FR-111 Dock appointment scheduling

- **Priority:** Could · **Status:** pending · **Tickets:** SP-189
- **Acceptance criteria:**
  1. Carriers' inbound and outbound appointments are booked against dock doors and time slots without overlaps, linked to ASNs and waves.

#### FR-112 Offline-tolerant scanner PWA

- **Priority:** Could · **Status:** pending · **Tickets:** SP-187
- **Acceptance criteria:**
  1. Receiving, putaway and picking scans queue locally when the network drops and replay in order on reconnect with idempotency keys; conflicting replays are surfaced to the user, never silently applied.

---

## 2. Non-functional requirements

#### NFR-001 No overselling

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-051
- **Acceptance criteria:** Under any number of concurrent allocation requests, `allocated ≤ on_hand` holds for every balance row. Enforced in three layers: the pure planner works only on locked rows; the shared `applyEffect` rejects over-allocation; the `stock_balances_allocated_le_on_hand` CHECK rejects any write that slips through. Verified by the 12-way race test (7 succeed, 5 rejected, 35 of 39 units allocated).

#### NFR-002 Deadlock-free locking

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040, SP-051
- **Acceptance criteria:** Allocation locks all candidate rows in one statement ordered by `(sku_id, id)` with SKU IDs sorted; ledger appends lock balance rows in sorted `bin|sku|lot` key order. If PostgreSQL still reports a deadlock or serialisation failure the API returns `503 CONCURRENCY_RETRY`, never a partial write.

#### NFR-003 Ledger immutability and traceability

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-040, SP-014
- **Acceptance criteria:** No code path updates or deletes `inventory_movements` and the trigger rejects attempts. Every movement has actor, timestamp, correlation ID and (where applicable) reason and reference; every inventory and allocation command writes an audit row in the same transaction.

#### NFR-004 Projection consistency

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-041
- **Acceptance criteria:** After any sequence of receipts, moves, adjustments, allocations and releases, `/inventory/projection/verify` returns `consistent: true`. Projection and ledger change in one transaction; a failed command leaves neither changed.

#### NFR-005 Exact integer quantity arithmetic

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-030
- **Acceptance criteria:** All stored quantities are integers in base units (`bigint` columns, `Number.isSafeInteger` checks); no floating-point rounding occurs; quantities and conversion results are capped at 10^12 so sums stay below 2^53; non-integral conversions are rejected. Property-based tests round-trip random quantities through every ladder level.

#### NFR-006 Algorithmic bounds of core domain functions

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-050, SP-041, SP-030
- **Acceptance criteria:** `planAllocation` is O(n log n) in candidate rows; `projectBalances` is O(m) in movements; `breakdownQuantity` is O(levels). Domain functions are pure and never mutate their inputs (verified by tests on `applyEffect` and frozen ladders).

#### NFR-007 Password storage

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-010
- **Acceptance criteria:** Passwords (12–200 characters) are hashed with scrypt N=2^15, r=8, p=1, 64-byte key and a 16-byte random salt, stored as `scrypt$N$r$p$salt$key`; verification uses a constant-time comparison.

#### NFR-008 Session and cookie security

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-011
- **Acceptance criteria:** Session cookie is httpOnly, `SameSite=Lax`, `Secure` when `NODE_ENV=production`; the database holds only HMAC-SHA256 session IDs so a database leak cannot be replayed; sessions expire after `SESSION_TTL_HOURS` (default 12, max 720) and are deleted on logout. Cookies and the CSRF header are redacted from logs.

#### NFR-009 Account non-enumeration

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-010, SP-012
- **Acceptance criteria:** Registration returns the same 202 body for new and existing emails and never issues a session; login returns the same 401 for unknown email, wrong password and inactive account, with equalised hashing cost.

#### NFR-010 Brute-force and spraying resistance

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-012
- **Acceptance criteria:** An attacker gets at most 5 free guesses per account before exponential backoff (capped at 15 min) regardless of how many IPs are used, even when the guesses are sent concurrently; at most 50 failed logins and at most 20 distinct emails per normalised IP (IPv6 /64) per 15 minutes; at most 10 registrations per IP per hour; client IP cannot be spoofed via `X-Forwarded-For` unless the proxy is explicitly trusted, and production refuses to start without an explicit `TRUST_PROXY`.

#### NFR-011 HTTP hardening

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-003
- **Acceptance criteria:** Security headers of FR-002 on every response; request bodies limited to 256 KiB; responses are `no-store`; errors never include stack traces or SQL.

#### NFR-012 Validation at the boundary

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-002, SP-003
- **Acceptance criteria:** Every body, query and path parameter is parsed by a Zod schema from `@stockpilot/shared` (shared with the web client) before any database access; failures return `400 VALIDATION_FAILED` with issue paths.

#### NFR-013 Tenant data isolation

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-013, SP-020
- **Acceptance criteria:** No API returns or modifies another organisation's data; isolation is enforced by `organization_id` predicates in every repository query plus composite foreign keys for topology; cross-tenant IDs yield 404, not 403, so existence is not revealed.

#### NFR-014 Fail-fast configuration

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-002
- **Acceptance criteria:** The process refuses to start with invalid configuration and prints every invalid key; no insecure fallback (placeholder secret, blanket proxy trust) is accepted in production.

#### NFR-015 Structured, correlated logging

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-002, SP-003
- **Acceptance criteria:** Logs are JSON (pino) with level from `LOG_LEVEL`; every request log line carries the request ID returned in `x-request-id`; 4xx are logged at info with code and status, 5xx at error with the cause; secrets are redacted.

#### NFR-016 Safe schema evolution

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-004
- **Acceptance criteria:** Migrations are forward-only, transactional per file, and checksum-protected; the readiness probe reports the applied count so a deployment can be gated on it.

#### NFR-017 Automated quality gates

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-001, SP-005
- **Acceptance criteria:** CI runs lint, format check, typecheck, tests and build on every push; database tests run against the PostgreSQL installed on the CI runner (started with `systemctl`); coverage thresholds fail the build below shared 90% lines / 90% functions / 85% branches and API 80% lines / 80% functions / 70% branches.

#### NFR-018 Native, container-free portability

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-006
- **Acceptance criteria:** Development, CI and production need only Node.js 22 and a natively installed PostgreSQL; `./run.sh` takes a fresh checkout to a running, seeded system with no other prerequisites.

#### NFR-019 Performance targets

- **Priority:** Must · **Status:** pending · **Tickets:** SP-181
- **Acceptance criteria:** On a 4-vCPU / 8 GB host with 10,000 balance rows and 1 million movements: allocation of a 20-line order p95 < 250 ms, p99 < 500 ms; receipt/move p95 < 150 ms; balance query (50 rows) p95 < 100 ms; sustained 50 allocations/s on distinct SKUs with zero oversells and zero 5xx other than `CONCURRENCY_RETRY` (< 0.1%).

#### NFR-020 Metrics and dashboards

- **Priority:** Should · **Status:** pending · **Tickets:** SP-180
- **Acceptance criteria:** `GET /metrics` exposes request rate, latency histograms by route, error counts by code, pool utilisation, allocation outcomes (FULL/PARTIAL/NONE) and projection-verify results; dashboards show them with alert thresholds.

#### NFR-021 Multi-instance throttling and ASVS L2

- **Priority:** Must · **Status:** pending · **Tickets:** SP-183, SP-190
- **Acceptance criteria:** Throttle state (per-email backoff, per-IP windows, distinct-email caps, lock-out sketch) moves from process memory to a shared PostgreSQL-backed store (SP-190), so every limit holds across any number of API instances behind the proxy and survives restarts; an attacker alternating between instances gets no more attempts than against one. An OWASP ASVS Level 2 review is completed with all failures resolved or risk-accepted in writing (SP-183).

#### NFR-022 Backup and restore

- **Priority:** Must · **Status:** pending · **Tickets:** SP-182
- **Acceptance criteria:** Nightly `pg_dump` plus WAL archiving give RPO ≤ 15 min and RTO ≤ 1 h; an automated monthly drill restores to a scratch database and passes projection verification.

#### NFR-023 Accessibility

- **Priority:** Should · **Status:** pending · **Tickets:** SP-184
- **Acceptance criteria:** The web UI meets WCAG 2.1 AA: full keyboard operation, visible focus, labelled form controls, 4.5:1 text contrast, and status not conveyed by colour alone (expiry flags carry text).

#### NFR-024 Ledger scalability

- **Priority:** Should · **Status:** pending · **Tickets:** SP-186, SP-044
- **Acceptance criteria:** `inventory_movements` is partitioned by month; with 100 million movements, appends stay within NFR-019 targets and verification replays only from the latest snapshot.

#### NFR-025 End-to-end coverage of critical flows

- **Priority:** Should · **Status:** pending · **Tickets:** SP-185
- **Acceptance criteria:** Browser end-to-end tests cover login, receive, move, allocate, release and (as they land) ASN receipt, wave release, pick, pack and ship; they run in CI when browsers are available. Today only two smoke specs exist.

#### NFR-026 Offline tolerance for floor devices

- **Priority:** Could · **Status:** pending · **Tickets:** SP-187
- **Acceptance criteria:** Scanner flows survive a 5-minute network outage without data loss; replays are idempotent and ordered.

#### NFR-027 Bounded throttle memory without lock-out

- **Priority:** Must · **Status:** implemented · **Tickets:** SP-012
- **Acceptance criteria:** Each in-memory throttle store (per-email backoff, per-IP login window, per-IP distinct emails, per-IP registrations) holds at most 100,000 entries. When a store is full, a resumable cursor first sweeps lapsed entries across the whole store; only if every entry is still active is the entry with the least time left evicted, with a `throttle_store_full` warning logged. A new key is never refused because a store is full, so flooding the store cannot lock legitimate users out. When the per-email store has to evict an entry that is still active, that entry is absorbed into a fixed-size count-min sketch (4 × 16,384 cells ≈ 1 MiB, decays after two generations). The sketch is read only for emails with no entry in the store, so evicting an active lock-out does not cancel it, a successful login is never overridden, and unrelated users are not blocked. If any sketch row is more than 50% occupied, sketch reads are disabled, `throttle_sketch_saturated` is logged and `stats().saturatedReads` is incremented. This residual risk is accepted and documented in ADR-0020.
