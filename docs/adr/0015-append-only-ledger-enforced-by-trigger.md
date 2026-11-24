# ADR-0015: Append-only ledger enforced by a database trigger

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-040; follow-ups SP-044, SP-186

## Context and problem statement

The ledger is the source of truth (ADR-0009). If any code path, migration, support script or compromised credential can `UPDATE` or `DELETE` movements, the audit trail and the replay guarantee are worthless. Application discipline alone is not enough: an operator with `psql` access during an incident is the realistic threat.

## Decision drivers

- Immutability must hold for every client of the database, not just the API.
- Corrections must be visible as their own events.
- Low overhead on inserts.

## Considered options

1. `BEFORE UPDATE OR DELETE` row trigger that raises an exception.
2. Revoke `UPDATE`/`DELETE` privileges from the application role.
3. Application convention only.

## Decision outcome

Chosen option: **1**, with **2** planned as defence in depth. Migration `0003_inventory_ledger.sql` defines `reject_ledger_mutation()` raising `inventory_movements is append-only (UPDATE|DELETE rejected)` with SQLSTATE `insufficient_privilege`, attached as `inventory_movements_append_only`. Corrections are compensating movements: `ADJUST_IN`/`ADJUST_OUT` with a reason code (`DAMAGED`, `FOUND`, `LOST`, `EXPIRED`, `CORRECTION`), `DEALLOCATE` for releases. Today migrations and the API share one database role; SP-183 splits them into a migration owner and a runtime role that has no `UPDATE`, `DELETE` or `TRUNCATE` privilege on `inventory_movements`.

### Consequences

- Good: the guarantee holds against ad-hoc SQL as well as application bugs; covered by a database test.
- Good: the trigger costs nothing on `INSERT`.
- Bad: `TRUNCATE` is not a row-level operation and bypasses the trigger; the privilege split in SP-183 closes this, and meanwhile `db:reset` (which drops the schema) is refused in production.
- Bad: archiving old movements (SP-186) must detach partitions rather than delete rows; snapshots (SP-044) let replay start from a checkpoint instead.
