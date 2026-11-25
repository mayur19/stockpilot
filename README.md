# StockPilot

[![CI](https://github.com/mayur19/stockpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/mayur19/stockpilot/actions/workflows/ci.yml)

**Know exactly what is in every bin, and promise stock to orders without ever overselling it.**

StockPilot is a warehouse management system for third-party logistics (3PL) providers and
multi-warehouse operators. It models the physical warehouse (zones and addressed bins), SKUs with
unit-of-measure ladders and lot/expiry tracking, and records every stock change in an append-only
inventory ledger from which on-hand, allocated and available quantities are projected. Orders are
allocated FEFO, FIFO or LIFO under row-level locks so concurrent orders never claim the same units.
Receiving against ASNs, directed putaway, wave planning, pick-path optimisation, cartonization,
shipping, cycle counting, replenishment, returns and labels are designed and on the roadmap.

> **Project status: early build.** The platform foundation, authentication and the hardest core
> slice (warehouse topology, SKU/UoM math, the event-sourced inventory ledger and the
> concurrency-safe allocation engine) are implemented and tested. Everything else is designed,
> documented and tracked in the [backlog](docs/planning/backlog.md): **10.6 %** of the estimated
> effort (166 of 1,560 hours) is complete, see
> [implementation status](docs/planning/implementation-status.md). Pending API endpoints answer
> `501 Not Implemented` with their ticket id, and pending screens show a "Planned" badge and the
> ticket that delivers them.

## Project status

| Area                                                                                                                     | Status         | Tickets                          |
| ------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------- |
| Platform foundation: monorepo, config, logging, envelope, health/readiness, migrations, CI, `run.sh`, web shell, seed    | ✅ Implemented | SP-001 to SP-006, SP-060, SP-062 |
| Identity: registration, login/logout/me, Postgres sessions, CSRF, RBAC, audit write path, login/registration throttling  | ✅ Implemented | SP-010 to SP-014                 |
| Warehouse topology: warehouses, zones, validated bin codes, serpentine pick sequence                                     | ✅ Implemented | SP-020                           |
| Catalogue: SKUs with nested UoM ladders, lots with expiry                                                                | ✅ Implemented | SP-030, SP-031                   |
| Inventory ledger: receipts, moves, adjustments, on-hand projection, replay verification, stock screen                    | ✅ Implemented | SP-040, SP-041, SP-061           |
| Allocation: FEFO/FIFO/LIFO planner, locked allocation API, release                                                       | ✅ Implemented | SP-050, SP-051, SP-055           |
| Identity extensions: email-verified signup, users and invitations, roles, password reset, 3PL clients, audit browser     | ⏳ Pending     | SP-009, SP-015 to SP-019         |
| Topology extensions: bulk import, capacity enforcement, warehouse map, updates/deactivation                              | ⏳ Pending     | SP-021 to SP-024                 |
| Catalogue extensions: serial numbers, import/export, item attributes, UoM versioning                                     | ⏳ Pending     | SP-032 to SP-035                 |
| Inventory control: holds, point-in-time queries, snapshots, adjustment approvals                                         | ⏳ Pending     | SP-042 to SP-045                 |
| Allocation rules, pick-face/reserve awareness, backorders                                                                | ⏳ Pending     | SP-052 to SP-054                 |
| Inbound: ASNs, receiving with discrepancies, scanner flow, quality inspection                                            | ⏳ Pending     | SP-070 to SP-073                 |
| Putaway and slotting: directed putaway rules, putaway tasks, velocity slotting                                           | ⏳ Pending     | SP-080 to SP-082                 |
| Outbound orders and waves: order intake, lifecycle, wave planning and release                                            | ⏳ Pending     | SP-090 to SP-093                 |
| Picking: pick-path optimisation, pick tasks and short picks, batch/cluster picking, picker UI                            | ⏳ Pending     | SP-100 to SP-103                 |
| Packing and cartonization: carton types, 3D cartonization heuristic, pack station                                        | ⏳ Pending     | SP-110 to SP-112                 |
| Shipping: shipments and manifests, carrier rate tables, documents, ship confirmation                                     | ⏳ Pending     | SP-120 to SP-123                 |
| Cycle counting: ABC planning, blind counts, variance approval                                                            | ⏳ Pending     | SP-130 to SP-132                 |
| Replenishment: min/max rules, task generation, demand-based replenishment                                                | ⏳ Pending     | SP-140 to SP-142                 |
| Returns: RMA authorisation, returns receiving and disposition                                                            | ⏳ Pending     | SP-150, SP-151                   |
| Labels and handling units: Code128 SVG encoder, label templates, license plates (LPNs)                                   | ⏳ Pending     | SP-160 to SP-162                 |
| Reporting and billing: dashboards, inventory reports, ledger export, outbox and notifications, 3PL billing               | ⏳ Pending     | SP-170 to SP-174                 |
| Operations and hardening: metrics, load tests, backup drills, ASVS review, accessibility, E2E, partitioning, PWA, labour | ⏳ Pending     | SP-180 to SP-190                 |

## Quick start

Requirements: Node.js 22+, npm, and a natively installed PostgreSQL 15+ server running locally.
The defaults expect the socket in `/tmp`, port 5432, your OS user and no password (edit
`DATABASE_URL` in `.env` otherwise).

```bash
./run.sh
```

This checks prerequisites, creates `.env` from `.env.example` with a random `SESSION_SECRET`,
installs dependencies, creates the `stockpilot_dev` database, applies migrations, seeds demo data
(only if the database has no users yet) and starts:

- Web: http://localhost:5103
- API: http://127.0.0.1:4103 (proxied by the web dev server under `/api`)

```bash
curl -s http://127.0.0.1:4103/api/v1/health
curl -s -c jar -H 'content-type: application/json' \
  -d '{"email":"manager@stockpilot.test","password":"stockpilot-demo-2026"}' \
  http://127.0.0.1:4103/api/v1/auth/login
```

More requests (receipts, moves, allocations, CSRF header) are in the [API guide](docs/api/README.md).

## Demo logins (development only)

These accounts are created by the development seed and are public; never load the seed into a
production database. Password for all: `stockpilot-demo-2026`.

| Email                      | Role     | Organization         |
| -------------------------- | -------- | -------------------- |
| `owner@stockpilot.test`    | Owner    | Northwind Fulfilment |
| `manager@stockpilot.test`  | Manager  | Northwind Fulfilment |
| `operator@stockpilot.test` | Operator | Northwind Fulfilment |
| `viewer@stockpilot.test`   | Viewer   | Northwind Fulfilment |

Seeded data: warehouse **LDN1 London DC 1** (Europe/London) with a receiving dock (`RCV01`,
`RCV02`), ambient reserve bins `A-01-01-1-A` to `A-03-04-1-A`, forward-pick bins `P-01-01-0-A` to
`P-01-06-0-A` and a quarantine cage (`QCAGE1`), plus an empty second warehouse **MAN1**. Four SKUs
cover the tracking modes: `MILK-UHT-1L` (FEFO, lots + expiry, EA/CS 12/PL 480), `VIT-D3-60` (FEFO),
`BATT-AA-4` (FIFO, lots without expiry) and `TEE-NAVY-M` (untracked, automatic day lots). Receipts
use dates relative to today (including a lot near expiry and stock in quarantine), one putaway move
is recorded, and order `SO-100045` is allocated with a 7-day minimum shelf life.

## run.sh commands

| Command                     | Description                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `./run.sh` / `./run.sh dev` | Install deps, prepare `.env` + database, migrate, seed, launch API + web               |
| `./run.sh setup`            | Everything `dev` does, without launching                                               |
| `./run.sh migrate`          | Apply pending database migrations                                                      |
| `./run.sh seed`             | Load development demo data (skipped if already present)                                |
| `./run.sh reset [--yes]`    | Drop and recreate the schema, then migrate + seed (refused when `NODE_ENV=production`) |
| `./run.sh test`             | Unit + integration tests against the `stockpilot_test` database                        |
| `./run.sh e2e`              | Playwright end-to-end smoke tests (launches the app)                                   |
| `./run.sh check`            | Lint, format check, typecheck and tests (what CI runs)                                 |
| `./run.sh build`            | Production build of API and web                                                        |
| `./run.sh help`             | Show all commands                                                                      |

## Tech stack

| Layer    | Technology                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| API      | Node.js 22, Fastify 5, `@fastify/cookie`, TypeScript (strict), zod, pg, pino; built with tsup |
| Web      | React 18, React Router 6, Vite 7, plain CSS with design tokens                                |
| Database | PostgreSQL 15+ (native install), forward-only plain-SQL migrations with checksums             |
| Shared   | `@stockpilot/shared`: UoM, ledger, allocation and bin-code domain logic, zod schemas, RBAC    |
| Tests    | Vitest 3, Testing Library, Fastify `inject` against real PostgreSQL, Playwright               |
| Tooling  | npm workspaces, ESLint 9, Prettier, tsx, GitHub Actions (runner's native PostgreSQL)          |

## Repository layout

```
stockpilot/
├── apps/
│   ├── api/                      Fastify API
│   │   ├── migrations/           0001_foundation, 0002_topology_catalog, 0003_inventory_ledger
│   │   ├── src/
│   │   │   ├── config/           zod-validated environment
│   │   │   ├── db/               pool, migration runner, CLI, development seed
│   │   │   ├── http/             envelope, errors, validation, auth throttles, count-min sketch
│   │   │   └── modules/
│   │   │       ├── health/ auth/ audit/          foundation (implemented)
│   │   │       ├── topology/ catalog/            warehouses, zones, bins, SKUs, lots (implemented)
│   │   │       ├── inventory/                    ledger, projection, verify (implemented slice)
│   │   │       ├── allocation/                   locked FEFO/FIFO/LIFO allocation (implemented slice)
│   │   │       └── pending/                      every planned endpoint, answering 501 + ticket
│   │   └── test/                 unit, HTTP and PostgreSQL integration tests (incl. allocation race)
│   └── web/                      React SPA: login, stock on hand, allocations; PlannedPage elsewhere
├── packages/shared/              domain logic (uom, ledger, allocation, bin-code), schemas, roles
├── e2e/                          Playwright config and smoke tests
├── docs/                         product, architecture, ADRs, design, API, security, testing, ops, planning
├── run.sh                        single entry point
└── .env.example                  placeholder configuration
```

## Documentation

Start with the [documentation index](docs/README.md). Key documents:
[PRD](docs/product/PRD.md) ·
[requirements](docs/product/requirements.md) ·
[architecture](docs/architecture/overview.md) ·
[ADRs](docs/adr/README.md) ·
[data model](docs/design/data-model.md) ·
[system design](docs/design/system-design.md) ·
[API](docs/api/README.md) ·
[OpenAPI](docs/api/openapi.yaml) ·
[threat model](docs/security/threat-model.md) ·
[test strategy](docs/testing/test-strategy.md) ·
[runbook](docs/operations/runbook.md) ·
[deployment](docs/operations/deployment.md) ·
[roadmap](docs/planning/roadmap.md) ·
[backlog](docs/planning/backlog.md) ·
[implementation status](docs/planning/implementation-status.md)

## Known limitations

- Only topology, catalogue, the inventory ledger and allocation are usable end to end; receiving
  against ASNs, putaway, waves, picking, packing, shipping, counts and returns are pending (see the
  status table).
- Login and registration throttles live in process memory, so the API must run as a single
  instance until the shared PostgreSQL store lands (SP-183, SP-190); see
  [ADR-0020](docs/adr/0020-auth-throttle-store-fail-closed-sketch.md) for the residual risks.
- Allocation, moves and release take stock-row locks in different orders, so a rare deadlock
  surfaces as `503 CONCURRENCY_RETRY` and the client must retry (tracked under SP-181).
- Playwright smoke tests are not run in CI; run them locally with `./run.sh e2e`.
- Registration creates the owner without email verification (SP-009), and there is no user
  management yet (SP-015).
- No external services by design: email, carriers and labels will use a local outbox, local rate
  tables and an in-house barcode encoder.

## Contributing, security and license

- [Contributing guide](CONTRIBUTING.md): workflow, commit conventions, engineering rules.
- [Security policy](SECURITY.md): how to report vulnerabilities; security model in brief.
- [Changelog](CHANGELOG.md).
- Licensed under the [MIT License](LICENSE).
