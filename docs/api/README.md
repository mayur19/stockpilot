# StockPilot API

The contract is [openapi.yaml](openapi.yaml) (OpenAPI 3.1). It describes the **full target API**:
27 operations are live (`x-status: implemented`) and 60 are registered but not built yet
(`x-status: pending`, each with `x-ticket: SP-xxx` from [the backlog](../planning/backlog.md)).
Implementation lives in `apps/api/src/modules/*/*.routes.ts`. The request schemas are the zod
schemas in `packages/shared/src/schemas/`.

## Conventions

| Topic         | Rule                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base path     | Every route is under `/api/v1`. The API listens on `http://127.0.0.1:4103` (`API_HOST`/`API_PORT`). The Vite dev server on `http://localhost:5103` proxies `/api` to it, and so does nginx in production.                                                                      |
| Media type    | Requests with a body must send `Content-Type: application/json` (otherwise `415 UNSUPPORTED_MEDIA_TYPE`). The body limit is 256 KiB. Leave out `Content-Type` on POSTs that have no body (logout, release), because Fastify rejects an empty JSON body with `400 BAD_REQUEST`. |
| Envelope      | Every JSON response is `{ "data": ..., "error": null, "meta"?: {...} }` on success and `{ "data": null, "error": { "code", "message", "details"? } }` on failure. `204` responses (logout) have no body.                                                                       |
| Status codes  | `200` read / action, `201` created or ledger entry appended, `202` registration accepted, `204` logout, then the error codes below.                                                                                                                                            |
| Ids           | Entity ids are UUIDs. Ledger movement ids are integers from a global `bigserial` and are also the pagination cursor.                                                                                                                                                           |
| Codes         | Warehouse, zone and SKU `code` fields allow letters, digits, `.`, `_` and `-` (1-32 characters) and are stored upper-cased. Bin codes are validated by `parseBinCode`.                                                                                                         |
| Timestamps    | `timestamptz` serialised as ISO-8601 UTC (`2026-11-25T09:14:03.120Z`). Expiry dates are calendar dates `YYYY-MM-DD` with no time zone. "Today" (expiry checks, `AUTO-` lot codes) is computed in the warehouse's IANA time zone.                                               |
| Request ids   | Every response carries `X-Request-Id`. A well-formed incoming `X-Request-Id` (`[A-Za-z0-9._-]{8,64}`) is echoed back; anything else is replaced with a UUID. The same id goes into the logs and into `audit_events.request_id`.                                                |
| Security hdrs | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cache-Control: no-store`.                                       |
| Tenancy       | Every query is scoped to the session's `organization_id`. Another organisation's ids answer `404`, never `403`.                                                                                                                                                                |
| Pending       | Pending routes sit behind authentication: `401` without a session and `403 CSRF_INVALID` for a mutating request without the header. After that they answer `501` with `details.ticket`.                                                                                        |

## Authentication, sessions and CSRF

1. `POST /api/v1/auth/register` creates an organisation and its `owner` user. It **always**
   answers `202 { status: "accepted", message }` with the same body, whether or not the email
   is taken, and sets **no cookies**. Throttle: `REGISTER_IP_MAX_ATTEMPTS` per client IP per hour.
2. `POST /api/v1/auth/login` verifies the scrypt hash. Unknown emails are checked against a
   dummy hash so both paths take the same time. On success the API sets two cookies, both
   `Path=/`, `SameSite=Lax`, expiring after `SESSION_TTL_HOURS` and `Secure` when `NODE_ENV=production`:
   - `sp_session`: HttpOnly opaque token. The database stores only HMAC-SHA256(`SESSION_SECRET`, token).
   - `sp_csrf`: readable by the SPA. The same value is returned as `data.csrfToken`.
3. Every request that is not `GET`/`HEAD`/`OPTIONS` and targets an authenticated route must send
   `X-CSRF-Token: <csrfToken>` (double submit, compared in constant time). A missing or wrong
   token answers `403 CSRF_INVALID`.
4. `GET /api/v1/auth/me` returns the user, the organisation and the CSRF token, so a reloaded SPA
   can recover the token.
5. `POST /api/v1/auth/logout` deletes the server-side session and clears both cookies (`204`).

### Login throttling

All counters live in the API process and are checked **before any I/O**. Each attempt is
reserved synchronously, so a burst of concurrent attempts cannot all slip past the check. With
`LOGIN_MAX_ATTEMPTS=3`, 20 parallel bad logins give exactly three `401`s and seventeen `429`s
(test: `auth.db.test.ts`). A successful login gives its reservation back.

| Limiter               | Key                 | Rule                                                                                                                                                                     |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-email backoff     | normalised email    | After `LOGIN_MAX_ATTEMPTS` failures the wait doubles from `LOGIN_BACKOFF_BASE_SECONDS`, capped at `LOGIN_WINDOW_MINUTES`. Failures are forgotten after 4 windows.        |
| Per-IP spraying guard | client IP           | `LOGIN_IP_MAX_ATTEMPTS` failures across all emails per `LOGIN_WINDOW_MINUTES` window.                                                                                    |
| Per-IP email fan-out  | client IP, IPv6 /48 | At most `LOGIN_IP_MAX_EMAILS` distinct emails per window per IPv4 address or IPv6 /64, and 4x that per IPv6 /48, so rotating through /64s inside one site does not help. |
| Registration          | client IP           | `REGISTER_IP_MAX_ATTEMPTS` per hour.                                                                                                                                     |

The client IP is normalised before it is used as a key: IPv4-mapped IPv6 collapses to IPv4,
and IPv6 is reduced to its /64 prefix. The IP comes from `request.ip`, which honours
`X-Forwarded-For` **only** for the proxies trusted by `TRUST_PROXY`
(see [runbook](../operations/runbook.md#configuration)).

The precise per-email cache is authoritative, and each throttle cache holds at most 100 000
keys. When a cache is full, expired entries are swept first. Only if every entry is still active
is the one with the least time left force-evicted, and the API logs the warning
`auth throttle store under pressure`. A force-evicted per-email entry is not forgotten: its
failure count and latest failure time are absorbed into a fixed-size count-min sketch (about
1 MiB, keyed by an HMAC of the email so collisions cannot be aimed at a victim; ADR-0020). The
sketch is read **only** for emails that have no precise entry. Ordinary failures never write to
it. As a result:

- an evicted lock-out is still enforced, so a flood of new keys cannot clear a victim's lock-out;
- failures spread across many emails never lock out an email nobody has touched;
- a successful login (a precise zero entry) always clears the lock-out.

If any sketch row becomes more than half occupied, the sketch is ignored for reads (otherwise
it would start throttling unrelated users), its `saturatedReads` counter increments, and the API
logs `auth throttle store under pressure` with `event: "throttle_sketch_saturated"`.

A throttled request answers `429 RATE_LIMITED` with a `Retry-After` header and
`details.retryAfterSeconds`.

### Roles and permissions

Handlers check permissions, not role names (`packages/shared/src/roles.ts`):

| Permission                                                            | viewer | operator | manager | admin | owner |
| --------------------------------------------------------------------- | :----: | :------: | :-----: | :---: | :---: |
| `topology:read`, `catalog:read`, `inventory:read`, `allocation:read`  |  yes   |   yes    |   yes   |  yes  |  yes  |
| `inventory:receive`, `inventory:move`                                 |        |   yes    |   yes   |  yes  |  yes  |
| `inventory:adjust`, `allocation:write`, `catalog:write`, `audit:read` |        |          |   yes   |  yes  |  yes  |
| `topology:write`, `inventory:verify`                                  |        |          |         |  yes  |  yes  |
| `users:manage`                                                        |        |          |         |  yes  |  yes  |

Each operation in `openapi.yaml` lists the permission it needs in `x-permission`.

## Error codes

Every code that `apps/api/src` can return:

| HTTP | Code                      | Raised when                                                                                                                                                                                                                                                                            |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_FAILED`       | A zod schema rejected the body, query or params. `details` is `[{ path, message }]`. Also used for service rules (lot/expiry required or forbidden, `fromBinId == toBinId`, expiry without lot tracking) and for a foreign key to a missing record (PG `23503`, `details.constraint`). |
| 400  | `BAD_REQUEST`             | Framework-level 4xx such as malformed JSON or an empty JSON body.                                                                                                                                                                                                                      |
| 400  | `INVALID_QUANTITY`        | Quantity not a positive safe integer, above 10^12, or overflowing after UoM conversion.                                                                                                                                                                                                |
| 400  | `INVALID_UOM`             | `uom` is not on the SKU's ladder (`details.allowed` lists valid units).                                                                                                                                                                                                                |
| 400  | `NON_INTEGRAL_CONVERSION` | A conversion between units would be fractional (domain helper `convertQuantity`).                                                                                                                                                                                                      |
| 400  | `INVALID_UOM_LADDER`      | Bad unit code, duplicate unit, factor < 2, or a level that is not a whole multiple of the level below.                                                                                                                                                                                 |
| 400  | `INVALID_BIN_CODE`        | Bin code is neither `ZONE-AA-RR-L-P` (aisle/rack from 01) nor a free-form code of 2-16 characters starting with a letter.                                                                                                                                                              |
| 400  | `INVALID_DATE`            | Expiry date not a real calendar date.                                                                                                                                                                                                                                                  |
| 400  | `INVALID_MOVEMENT`        | Movement shape is wrong for its type (ledger guard; not reachable through valid requests).                                                                                                                                                                                             |
| 401  | `UNAUTHENTICATED`         | No valid, unexpired session (or the user is deactivated).                                                                                                                                                                                                                              |
| 401  | `INVALID_CREDENTIALS`     | Login failed. Deliberately generic.                                                                                                                                                                                                                                                    |
| 403  | `FORBIDDEN`               | The role lacks the route's permission.                                                                                                                                                                                                                                                 |
| 403  | `CSRF_INVALID`            | Mutating request without a matching `X-CSRF-Token`.                                                                                                                                                                                                                                    |
| 404  | `NOT_FOUND`               | Warehouse, Zone, Bin, SKU, Lot or Allocation missing or owned by another organisation. The message names the entity.                                                                                                                                                                   |
| 404  | `ROUTE_NOT_FOUND`         | No such route.                                                                                                                                                                                                                                                                         |
| 409  | `ALREADY_EXISTS`          | Unique key violated (PG `23505`): duplicate warehouse/zone/bin/SKU code, or a second live allocation for the same `orderRef` in a warehouse. `details.constraint`.                                                                                                                     |
| 409  | `CONSTRAINT_VIOLATION`    | A stock CHECK constraint fired (PG `23514`), for example `allocated <= on_hand`. This is a backstop behind the domain checks.                                                                                                                                                          |
| 409  | `INSUFFICIENT_AVAILABLE`  | Move or negative adjustment larger than the bin's available quantity (on hand minus allocated). `details: { binId, lotId, requested, available }`.                                                                                                                                     |
| 409  | `INSUFFICIENT_ALLOCATED`  | A release would deallocate more than is allocated (ledger guard).                                                                                                                                                                                                                      |
| 409  | `INSUFFICIENT_STOCK`      | The allocation plan is empty, or a `shipComplete` order cannot be fully covered. `details.lines[]: { lineNo, skuId, requested, shortfall, excluded }`.                                                                                                                                 |
| 409  | `LOT_EXPIRY_MISMATCH`     | Receiving an existing lot code with a different expiry. `details: { lotCode, recorded, received }`.                                                                                                                                                                                    |
| 409  | `BIN_INACTIVE`            | The bin is deactivated. Bins can only be deactivated directly in the database until SP-024 ships.                                                                                                                                                                                      |
| 409  | `ALREADY_RELEASED`        | Releasing an allocation that is already `RELEASED`.                                                                                                                                                                                                                                    |
| 415  | `UNSUPPORTED_MEDIA_TYPE`  | Body sent with a content type other than JSON.                                                                                                                                                                                                                                         |
| 429  | `RATE_LIMITED`            | Login or registration throttle. Comes with a `Retry-After` header and `details.retryAfterSeconds`.                                                                                                                                                                                     |
| 500  | `INTERNAL_ERROR`          | Unexpected failure. Logged with the stack trace; the message is generic.                                                                                                                                                                                                               |
| 501  | `NOT_IMPLEMENTED`         | Pending endpoint. `details.ticket` is the backlog ticket.                                                                                                                                                                                                                              |
| 503  | `NOT_READY`               | `/ready` only: the database is unreachable or not migrated.                                                                                                                                                                                                                            |
| 503  | `CONCURRENCY_RETRY`       | PostgreSQL deadlock (`40P01`) or serialization failure (`40001`). The transaction was rolled back, so retrying is safe.                                                                                                                                                                |

Clients should branch on `error.code`, never on `message`.

## Pagination and lists

- **Keyset (ledger):** `GET /inventory/movements` returns the newest entries first and answers
  `meta: { limit, nextCursor }`. `nextCursor` is the last row's `id` as a string, or `null` when
  the page had fewer than `limit` rows. To get the next (older) page, pass it back as
  `before=<cursor>`; the query is `id < before ORDER BY id DESC`. The cursor stays stable while
  new movements are appended, so pages never shift or repeat.
- **Bounded lists:** `GET /inventory/balances` answers `meta: { count, limit }` and
  `GET /allocations` takes `limit`. For both, `limit` is 1-200 with a default of 50 and there is
  no cursor yet. `GET /skus` returns at most 200 rows. Warehouses, zones, bins and lots return
  everything for their parent.

## Quantities and units of measure

- The ledger and the projection store **whole base units** only (for example `EA`). Quantities
  are positive safe integers no greater than 10^12, so sums never lose precision.
- Each SKU has a nested ladder, for example `EA` (1) < `CS` (12) < `PL` (480). Every level must
  be a whole multiple (at least 2x) of the level below it.
- Write endpoints take `quantity` together with an optional `uom` (default: the SKU's base unit)
  and convert with `toBaseUnits`. `"quantity": 2, "uom": "CS"` stores 24 EA. A unit missing from
  the ladder answers `INVALID_UOM`. Fractional input is rejected by the schema; conversions are
  never rounded.
- Responses always use base units. The receipt response adds a human-readable breakdown, for
  example `"quantityDescription": "1 PL + 3 CS + 4 EA"`.
- Adjustments take a signed `delta` in base units.
- `available = onHand - allocated`. Moves, negative adjustments and allocations can only
  consume available units.

## Curl walkthrough (seeded demo data)

`./run.sh setup` seeds the organisation "Northwind Fulfilment" with warehouses `LDN1` and `MAN1`.
The demo users are `owner@`, `manager@`, `operator@` and `viewer@stockpilot.test`, all with the
password `stockpilot-demo-2026` (development only).

```bash
API=http://127.0.0.1:4103/api/v1
JAR=$(mktemp)

# Health and readiness (public)
curl -s $API/health
curl -s $API/ready

# Sign in as the manager; keep the cookies and the CSRF token
CSRF=$(curl -s -c "$JAR" -H 'Content-Type: application/json' \
  -d '{"email":"manager@stockpilot.test","password":"stockpilot-demo-2026"}' \
  $API/auth/login | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.csrfToken')

curl -s -b "$JAR" $API/auth/me

# Look up the LDN1 warehouse, the milk SKU and a storage bin
WH=$(curl -s -b "$JAR" $API/warehouses | node -pe \
  'JSON.parse(require("fs").readFileSync(0)).data.find(w=>w.code==="LDN1").id')
SKU=$(curl -s -b "$JAR" "$API/skus?search=MILK" | node -pe \
  'JSON.parse(require("fs").readFileSync(0)).data[0].id')
BIN=$(curl -s -b "$JAR" "$API/warehouses/$WH/bins" | node -pe \
  'JSON.parse(require("fs").readFileSync(0)).data.find(b=>b.code==="A-01-03-1-A").id')

# Stock on hand for the SKU (base units, with allocated and available)
curl -s -b "$JAR" "$API/inventory/balances?warehouseId=$WH&skuId=$SKU"

# Receive 3 cases of a new lot (lot- and expiry-tracked SKU), stored as 36 EA
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d "{\"warehouseId\":\"$WH\",\"binId\":\"$BIN\",\"skuId\":\"$SKU\",\"quantity\":3,\"uom\":\"CS\",
       \"lotCode\":\"M2412D\",\"expiryDate\":\"2027-03-31\",\"reference\":\"PO-7781\"}" \
  $API/inventory/receipts

# Allocate an order FEFO with at least 7 days of shelf life, partial allowed
ALLOC=$(curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d "{\"warehouseId\":\"$WH\",\"orderRef\":\"SO-200001\",\"minShelfLifeDays\":7,
       \"lines\":[{\"skuId\":\"$SKU\",\"quantity\":2,\"uom\":\"CS\"}]}" \
  $API/allocations | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')
curl -s -b "$JAR" "$API/allocations/$ALLOC"

# Release it (no body, so no Content-Type)
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -X POST "$API/allocations/$ALLOC/release"

# Ledger, newest first, two per page, then the next page
curl -s -b "$JAR" "$API/inventory/movements?warehouseId=$WH&limit=2"
curl -s -b "$JAR" "$API/inventory/movements?warehouseId=$WH&limit=2&before=<meta.nextCursor>"

# A pending endpoint: 501 with the ticket
curl -s -b "$JAR" "$API/waves?warehouseId=$WH"
# {"data":null,"error":{"code":"NOT_IMPLEMENTED","message":"Wave planning is planned but not implemented yet","details":{"ticket":"SP-092"}}}

# Without the CSRF header a mutation is refused
curl -s -b "$JAR" -X POST "$API/allocations/$ALLOC/release"
# {"data":null,"error":{"code":"CSRF_INVALID","message":"Missing or invalid CSRF token"}}

curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -X POST -o /dev/null -w '%{http_code}\n' $API/auth/logout
```

Projection verification needs `inventory:verify`, which only `admin` and `owner` hold. The
manager gets `403 FORBIDDEN`:

```bash
OWNER_JAR=$(mktemp)
curl -s -c "$OWNER_JAR" -H 'Content-Type: application/json' \
  -d '{"email":"owner@stockpilot.test","password":"stockpilot-demo-2026"}' $API/auth/login >/dev/null
curl -s -b "$OWNER_JAR" $API/inventory/projection/verify
# {"data":{"consistent":true,"movementCount":13,"balanceCount":11,"mismatches":[]},"error":null}
```

(The counts shown are for a freshly seeded database.)
