# StockPilot

[![CI](https://github.com/mayur19/stockpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/mayur19/stockpilot/actions/workflows/ci.yml)

A warehouse management system for 3PL and multi-warehouse operations: warehouse topology,
SKUs with unit-of-measure ladders, lot and expiry tracking, an event-sourced inventory
ledger and a concurrency-safe FEFO/FIFO/LIFO allocation engine — with receiving, putaway,
waves, pick-path optimisation, cartonization, shipping, cycle counting, replenishment and
returns on the roadmap.

> **Status:** foundation + first vertical slice implemented (**10.6%** of estimated work,
> see [implementation status](docs/planning/implementation-status.md)). Every planned
> endpoint is already registered and answers `501` with its backlog ticket.

## What works today

- **Topology:** warehouses (canonical IANA time zones), typed zones (receiving, storage,
  pick, staging, shipping, quarantine) and bins addressed `ZONE-AA-RR-L-P` with a serpentine
  default pick sequence.
- **Catalogue:** SKUs with nested UoM ladders (`EA → CS (12) → PL (480)`), exact integer
  conversion that refuses to round, lot and expiry tracking.
- **Inventory ledger:** append-only movements (database-enforced) for receipts, moves and
  reason-coded adjustments; on-hand / allocated / available projection updated in the same
  transaction; full replay verification endpoint that detects drift.
- **Allocation:** pure planner in `packages/shared` (FEFO/FIFO/LIFO, expired/held/short
  shelf-life exclusion, best-fit then largest-first pick minimisation, ship-complete,
  multi-line shared pool) executed under ordered `SELECT … FOR UPDATE` locks — a race test
  fires 12 concurrent orders at 39 units and proves nothing is oversold. Release writes
  compensating ledger entries.
- **Platform:** session auth (scrypt, Postgres sessions, CSRF double-submit), RBAC,
  audit log, login throttling (per-email backoff + per-IP spraying guard), non-enumerating
  registration, request IDs, structured logs, JSON envelope.
- **Web:** login, navigation with Planned sections, stock-on-hand by bin with receive and
  move forms, allocation screen with pick lists and release.

## Quick start

Requirements: Node.js 22+, npm, and a natively installed PostgreSQL 15+ running locally
(defaults: socket in `/tmp`, port 5432, your OS user, no password).

```bash
./run.sh setup   # deps, .env with random secret, create DB, migrate, seed demo data
./run.sh         # API on http://127.0.0.1:4103, web on http://localhost:5103
```

Demo users (development seed only), password `stockpilot-demo-2026`:

| Email                    | Role     |
| ------------------------ | -------- |
| owner@stockpilot.test    | owner    |
| manager@stockpilot.test  | manager  |
| operator@stockpilot.test | operator |
| viewer@stockpilot.test   | viewer   |

Other commands: `./run.sh help | migrate | seed | reset | test | e2e | check | build`.

```bash
# API smoke test
curl -s http://127.0.0.1:4103/api/v1/health
curl -s -c jar -H 'content-type: application/json' \
  -d '{"email":"manager@stockpilot.test","password":"stockpilot-demo-2026"}' \
  http://127.0.0.1:4103/api/v1/auth/login
```

More in the [API guide](docs/api/README.md).

## Stack

TypeScript (strict) on Node.js 22 · Fastify 5 · PostgreSQL (`pg`, plain SQL) · zod · pino ·
React 18 + Vite + React Router · Vitest + Testing Library · Playwright (smoke). No external
services; nothing calls the internet at runtime.

## Repository layout

```
apps/api/          Fastify API: src/{config,db,http,modules/*}, migrations/*.sql, test/
apps/web/          React SPA (plain CSS design tokens)
packages/shared/   Domain logic (UoM, ledger, allocation, bin codes), zod schemas, RBAC
docs/              Product, architecture, ADRs, design, API, security, testing, ops, planning
e2e/               Playwright smoke specs (run locally with ./run.sh e2e)
run.sh             Single launcher
```

## Quality gates

`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
all run in CI against the runner's native PostgreSQL. Coverage gates: shared 90% lines,
API 80%, web 80%.

## Documentation

Start at [docs/README.md](docs/README.md). Highlights: [PRD](docs/product/PRD.md),
[system design](docs/design/system-design.md), [ADRs](docs/adr/README.md),
[OpenAPI](docs/api/openapi.yaml), [roadmap](docs/planning/roadmap.md),
[backlog](docs/planning/backlog.md).

## License

[MIT](LICENSE) © Mayur Dusane
