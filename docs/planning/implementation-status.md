# Implementation status

StockPilot is deliberately built foundation-first: the platform, identity and the hardest
core slice (topology + UoM + event-sourced ledger + concurrency-safe allocation) are real,
tested and running; everything else is designed, specified and tracked as pending.

## How the percentage is computed

`implemented % = sum(estimate hours of tickets with status done) / sum(estimate hours of all tickets)`
using the estimates in [backlog.md](backlog.md). Estimates include tests and documentation.
A ticket counts as done only when its code, migrations, tests and docs are merged and CI is green.

|                 |     Hours |
| --------------- | --------: |
| Done            |       166 |
| Pending         |      1394 |
| **Total**       |  **1560** |
| **Implemented** | **10.6%** |

## By epic

| Epic                        | Done (h) | Total (h) |    % |
| --------------------------- | -------: | --------: | ---: |
| E01 Platform foundation     |       41 |        41 | 100% |
| E02 Identity & access       |       31 |       123 |  25% |
| E03 Warehouse topology      |       10 |        64 |  16% |
| E04 Catalogue & UoM         |       14 |        70 |  20% |
| E05 Inventory ledger        |       36 |       100 |  36% |
| E06 Allocation              |       34 |        86 |  40% |
| E07 Inbound & receiving     |        0 |        88 |   0% |
| E08 Putaway & slotting      |        0 |        76 |   0% |
| E09 Outbound orders & waves |        0 |        88 |   0% |
| E10 Picking & pick paths    |        0 |       116 |   0% |
| E11 Packing & cartonization |        0 |        80 |   0% |
| E12 Shipping                |        0 |        68 |   0% |
| E13 Cycle counting          |        0 |        56 |   0% |
| E14 Replenishment           |        0 |        60 |   0% |
| E15 Returns                 |        0 |        36 |   0% |
| E16 Labels & handling units |        0 |        64 |   0% |
| E17 Reporting & billing     |        0 |       108 |   0% |
| E18 Operations & hardening  |        0 |       236 |   0% |

## Done

- **Platform (SP-001..006):** npm workspaces, strict TypeScript, ESLint/Prettier, zod-validated
  config, pino logs with redaction, response envelope, request IDs, security headers,
  `/health` and `/ready`, checksum-verified forward-only migrations, CI on the runner's native
  PostgreSQL, `run.sh`.
- **Identity (SP-010..014):** non-enumerating owner registration (202, no session), login /
  logout / me, HMAC-hashed Postgres sessions, CSRF double-submit, per-email progressive backoff,
  per-IP spraying window, distinct-email caps per IPv6 /64 and /48, per-IP registration limit,
  attempts reserved before any I/O, force-evicted active lock-outs spilled into a fixed-size count-min sketch (ADR-0020), `TRUST_PROXY` (default false), RBAC
  permissions, audit write path.
- **Topology & catalogue (SP-020, SP-030, SP-031):** warehouses with canonical IANA time zones,
  typed zones, validated bin codes with serpentine pick sequence, SKUs with nested UoM ladders,
  lots with expiry and automatic day lots for untracked SKUs.
- **Ledger (SP-040, SP-041):** append-only `inventory_movements` (trigger-enforced), synchronous
  `stock_balances` projection with ordered row locks, receipts in any pack unit, moves,
  reason-coded adjustments, keyset-paginated movement history, full replay verification.
- **Allocation (SP-050, SP-051, SP-055):** pure FEFO/FIFO/LIFO planner with expiry, shelf-life
  and hold filters, pick minimisation, multi-line shared pool and ship-complete; transactional
  API with `SELECT … FOR UPDATE` in a fixed lock order, proven by a concurrent race test;
  release with compensating `DEALLOCATE` entries.
- **Web (SP-060..062):** login, app shell with Planned badges, stock-on-hand by bin with
  receive and move forms, allocation screen with pick list and release; demo seed.

## Stubbed (registered, answer 501 with a ticket)

Every endpoint in `apps/api/src/modules/pending/pending.catalog.ts` is registered behind
authentication and returns `501 NOT_IMPLEMENTED` with `details.ticket`, mirroring the
`x-status: pending` operations in [openapi.yaml](../api/openapi.yaml): users and roles,
email verification, password reset, 3PL clients, audit browser, topology/SKU updates and
imports, holds, as-of queries, snapshots, ASNs and receiving, putaway, slotting, orders,
waves, pick paths and tasks, cartonization, packing, shipments, manifests, carrier rates,
cycle counts, replenishment, returns, labels, dashboards, reports, notifications, billing
and metrics.

## Schema coverage

Migrations 0001–0003 create 14 of the ~40 tables in the target model
([data-model.md](../design/data-model.md)); the remaining tables arrive with their tickets.

## Test evidence

| Workspace                                     | Tests | Coverage gate (lines / branches) |
| --------------------------------------------- | ----: | -------------------------------- |
| packages/shared                               |    77 | 90% / 85%                        |
| apps/api (unit + real PostgreSQL integration) |    73 | 80% / 70%                        |
| apps/web (React Testing Library)              |    26 | 80% / 75%                        |
