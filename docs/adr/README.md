# Architecture decision records

Decisions are recorded in [MADR](https://adr.github.io/madr/) format: context and problem statement, decision drivers, considered options, decision outcome and consequences. Numbering is fixed — source comments reference these IDs (e.g. `ADR-0011` in `allocation.repository.ts`). A superseded ADR keeps its number and gains a "Superseded by" line; it is never deleted or renumbered.

| ADR                                                              | Title                                                                                                   | Status   | Date    | Area                 | Tickets                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- | ------- | -------------------- | ---------------------- |
| [0001](0001-modular-monolith-with-npm-workspaces.md)             | Modular monolith with npm workspaces                                                                    | Accepted | 2026-11 | Platform             | SP-001                 |
| [0002](0002-typescript-strict-fastify-react-vite.md)             | TypeScript strict + Fastify 5 + React/Vite                                                              | Accepted | 2026-11 | Platform             | SP-001, SP-060         |
| [0003](0003-postgresql-only-datastore.md)                        | PostgreSQL as the only datastore, no external services                                                  | Accepted | 2026-11 | Platform             | SP-004, SP-173         |
| [0004](0004-zod-validated-configuration-and-boundaries.md)       | Zod-validated configuration and boundary validation                                                     | Accepted | 2026-11 | Platform             | SP-002, SP-003         |
| [0005](0005-json-response-envelope-and-error-codes.md)           | JSON response envelope and error codes                                                                  | Accepted | 2026-11 | API                  | SP-003                 |
| [0006](0006-session-auth-csrf-rbac-throttling.md)                | Session auth, CSRF, RBAC and authentication throttling                                                  | Accepted | 2026-11 | Security             | SP-010–SP-013, SP-183  |
| [0007](0007-forward-only-sql-migrations-with-checksums.md)       | Forward-only plain SQL migrations with checksums                                                        | Accepted | 2026-11 | Data                 | SP-004                 |
| [0008](0008-integer-base-units-with-nested-uom-ladders.md)       | Quantities as integer base units with nested UoM ladders                                                | Accepted | 2026-11 | Domain               | SP-030                 |
| [0009](0009-event-sourced-ledger-with-synchronous-projection.md) | Event-sourced inventory ledger with synchronous projection                                              | Accepted | 2026-11 | Domain               | SP-040, SP-041         |
| [0010](0010-allocation-engine-as-pure-function.md)               | Allocation engine as a pure function                                                                    | Accepted | 2026-11 | Domain               | SP-050, SP-051         |
| [0011](0011-pessimistic-ordered-row-locking.md)                  | Pessimistic ordered row locking vs optimistic versioning vs SERIALIZABLE                                | Accepted | 2026-11 | Domain / concurrency | SP-051, SP-055         |
| [0012](0012-lots-as-first-class-records-with-auto-lots.md)       | Lots as first-class records with auto lots for untracked SKUs                                           | Accepted | 2026-11 | Domain               | SP-031                 |
| [0013](0013-only-storage-and-pick-zones-allocatable.md)          | Only STORAGE and PICK zones are allocatable                                                             | Accepted | 2026-11 | Domain               | SP-020, SP-051         |
| [0014](0014-bin-addressing-and-serpentine-pick-sequence.md)      | Bin addressing scheme and serpentine default pick sequence                                              | Accepted | 2026-11 | Domain               | SP-020                 |
| [0015](0015-append-only-ledger-enforced-by-trigger.md)           | Append-only ledger enforced by a database trigger                                                       | Accepted | 2026-11 | Data                 | SP-040                 |
| [0016](0016-tenancy-via-organization-id-scoping.md)              | Tenancy via organization_id scoping in repositories (vs row-level security)                             | Accepted | 2026-11 | Security / data      | SP-010, SP-018         |
| [0017](0017-pick-path-optimisation-heuristic.md)                 | Pick path optimisation heuristic                                                                        | Proposed | 2026-11 | Domain               | SP-100                 |
| [0018](0018-cartonization-heuristic.md)                          | Cartonization heuristic                                                                                 | Proposed | 2026-11 | Domain               | SP-111                 |
| [0019](0019-native-postgresql-and-systemd-deployment.md)         | Native PostgreSQL and systemd deployment, no containers                                                 | Accepted | 2026-11 | Operations           | SP-005, SP-006         |
| [0020](0020-auth-throttle-store-fail-closed-sketch.md)           | Authentication throttle state: bounded authoritative maps with an overflow sketch for evicted lock-outs | Accepted | 2026-11 | Security             | SP-012, SP-183, SP-190 |

Domain-specific decisions (0008–0018) make up more than half of the set (11 of 20).

## Writing a new ADR

1. Copy the structure of an existing ADR and take the next free number.
2. Start with `Status: Proposed`; change to `Accepted` when the implementing ticket is merged.
3. Reference the ADR from the code that embodies it (`// ADR-00NN`) and add a row here.
