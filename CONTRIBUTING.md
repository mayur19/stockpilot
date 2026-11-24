# Contributing

## Prerequisites

- Node.js 22+ and npm
- A natively installed PostgreSQL 15+ server (the defaults expect the socket in `/tmp`,
  your OS user and no password)

```bash
./run.sh setup   # install, create .env with a random secret, create DB, migrate, seed
./run.sh         # start API (http://127.0.0.1:4103) and web (http://localhost:5103)
./run.sh check   # lint, format check, typecheck and tests — what CI runs
```

## Workflow

1. Pick a ticket from [docs/planning/backlog.md](docs/planning/backlog.md) and read the
   linked requirements and ADRs.
2. Put pure domain logic in `packages/shared/src/domain` with unit tests first; keep
   functions small and return new objects instead of mutating inputs.
3. API modules live in `apps/api/src/modules/<domain>` (routes → service → repository).
   Every query must be scoped by `organization_id`. Validate every input with zod.
4. Schema changes are new files in `apps/api/migrations` (`NNNN_description.sql`). Never
   edit an applied migration — the runner rejects checksum changes.
5. When a pending endpoint becomes real, remove it from
   `apps/api/src/modules/pending/pending.catalog.ts`, flip `x-status` in
   `docs/api/openapi.yaml`, and update the backlog, traceability matrix and
   implementation status.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`.
- Coverage gates are enforced per workspace (`npm run test:coverage`).
- Quantities are integers in the SKU's base unit; convert at the boundary with the UoM
  ladder helpers.
- Keep files under 400 lines.
