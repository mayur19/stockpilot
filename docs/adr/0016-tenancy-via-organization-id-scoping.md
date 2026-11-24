# ADR-0016: Tenancy via organization_id scoping in repositories

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-010, SP-020; follow-ups SP-018, SP-183

## Context and problem statement

StockPilot is multi-tenant: each organisation (a 3PL operator or a brand running its own sites) must never see another's warehouses, SKUs or stock. Later, a 3PL organisation will host several clients whose inventory must also be separated (SP-018). Where is isolation enforced?

## Decision drivers

- A missing filter must not leak data silently.
- Low friction for writing queries and tests.
- Compatible with connection pooling (one pool, many tenants).
- Room for a second level of scoping (client within organisation).

## Considered options

1. `organization_id` column on tenant-owned tables; every repository function takes `orgId` and includes it in `WHERE`; composite foreign keys keep children in the parent's tenant.
2. PostgreSQL row-level security (RLS) with `SET app.org_id` per transaction.
3. Schema per tenant.
4. Database per tenant.

## Decision outcome

Chosen option: **1**. The `orgId` always comes from the authenticated session (`request.auth.organizationId`), never from the request body. Repository signatures make it mandatory (`findWarehouse(db, orgId, warehouseId)`), and lookups by ID include it, so a guessed UUID from another tenant returns 404. The schema reinforces this where cheap: `zones (organization_id, warehouse_id)` references `warehouses (organization_id, id)`, and `bins (warehouse_id, zone_id)` references `zones (warehouse_id, id)`, so a bin cannot be attached to another warehouse's zone. Child tables without their own `organization_id` (`allocation_lines`, `allocation_picks`) are only reachable through a scoped parent.

RLS was rejected for now because every request would need a `SET LOCAL` inside a transaction (including reads that today run on the pool), policies are easy to bypass with a superuser or `BYPASSRLS` role used in migrations, and failures surface as empty results that are harder to debug. It remains a defence-in-depth option evaluated in SP-183.

### Consequences

- Good: explicit, greppable, easy to test; organisation isolation is covered by a database test.
- Good: one schema and one pool for all tenants.
- Bad: a forgotten predicate in a new query would leak data; mitigated by code review, the repository pattern and a planned cross-tenant test suite that calls every endpoint with foreign IDs (SP-183).
- Bad: ledger and balance foreign keys reference `warehouses(id)`, `skus(id)` etc. without the tenant column; service code validates every referenced entity against `orgId` before writing.
- Neutral: 3PL client scoping (SP-018) adds `client_id` to SKUs and stock with the same pattern.
