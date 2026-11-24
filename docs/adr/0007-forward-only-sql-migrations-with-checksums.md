# ADR-0007: Forward-only plain SQL migrations with checksums

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-004

## Context and problem statement

The schema carries much of the system's safety: CHECK constraints backstop the allocation engine, a trigger makes the ledger append-only, partial unique indexes stop duplicate open allocations. These features are awkward or impossible to express through an ORM's schema DSL. We also need confidence that what runs in production is exactly what was reviewed.

## Decision drivers

- Full access to PostgreSQL features (triggers, partial indexes, composite foreign keys, plpgsql).
- Each migration atomic: either fully applied or not at all.
- Detect a migration that was edited after being applied anywhere.
- No extra runtime dependency.

## Considered options

1. Small in-repo runner over plain `.sql` files, forward-only, with a `schema_migrations` table storing SHA-256 checksums.
2. An ORM migration system (Prisma, TypeORM, Drizzle Kit).
3. `node-pg-migrate` or Knex migrations with up/down functions.

## Decision outcome

Chosen option: **1**. `apps/api/src/db/migrate.ts` reads `migrations/NNNN_description.sql` in lexical order, creates `schema_migrations (name, checksum, applied_at)` if needed, and applies each pending file plus its bookkeeping row inside one transaction. If an applied file's SHA-256 differs from the recorded checksum, the runner aborts with "was modified after being applied; add a new migration instead". There are no down migrations: corrections are new forward migrations. `npm run db:migrate`, `db:seed` and `db:reset` (refused when `NODE_ENV=production`) wrap the runner.

### Consequences

- Good: migrations are reviewable SQL; constraints such as `stock_balances_allocated_le_on_hand` are visible to reviewers.
- Good: CI runs `db:reset` from zero on every push, proving the chain is reproducible.
- Bad: no automatic rollback; a deploy rollback requires the previous release to be compatible with the new schema (expand/contract across two releases).
- Bad: statements that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`) need a future opt-out marker; until then large-table indexes are created in a maintenance window.
