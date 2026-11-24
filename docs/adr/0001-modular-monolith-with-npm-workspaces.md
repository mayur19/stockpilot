# ADR-0001: Modular monolith with npm workspaces

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-001

## Context and problem statement

StockPilot spans many warehouse capabilities (topology, catalogue, ledger, allocation, inbound, picking, packing, shipping, counting, billing). The hardest parts — UoM math, the event-sourced ledger and the allocation engine — must be shared by the API and, for display and form hints, by the web client. The team is small, and every operation that touches stock must be strongly consistent with every other one. How should the codebase and runtime be partitioned?

## Decision drivers

- Allocation, moves and receipts must commit atomically against the same stock rows; distributed transactions are not acceptable.
- Pure domain logic must be testable without a database or HTTP server.
- One deployable unit keeps operations simple on a single host (ADR-0019).
- Clear internal boundaries so modules can be extracted later if load demands it.

## Considered options

1. Modular monolith in one repository with npm workspaces: `apps/api`, `apps/web`, `packages/shared`.
2. Microservices per bounded context (inventory, orders, auth) with their own databases.
3. Single package with no internal workspace boundaries.
4. A third-party monorepo tool (Nx, Turborepo) on top of workspaces.

## Decision outcome

Chosen option: **1, modular monolith with npm workspaces**, because a single PostgreSQL transaction can cover ledger append, projection update, allocation rows and audit, while workspaces still give a hard compile-time boundary between pure domain code (`packages/shared`) and I/O code (`apps/api`). Inside the API, modules live in `apps/api/src/modules/<domain>/` with `routes -> service -> repository` layering.

### Consequences

- Good: atomic multi-table writes (ADR-0009, ADR-0011) are trivial.
- Good: `packages/shared` can be imported by the web app for types, schemas and quantity formatting without duplicating rules.
- Good: no extra build tool; `npm run <script> --workspaces` covers lint, typecheck, test and build.
- Bad: one process means one failure domain and vertical scaling until SP-183 and SP-190 move the in-memory throttles to PostgreSQL.
- Bad: boundaries between API modules are by convention; an import-boundary lint rule is planned under SP-183.
- Neutral: extracting a module later requires replacing in-process calls with an API and the outbox (SP-173).
