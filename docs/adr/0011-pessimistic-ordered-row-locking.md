# ADR-0011: Pessimistic ordered row locking for allocation

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-051, SP-055; follow-up SP-181

## Context and problem statement

Many planners and integrations allocate concurrently, often against the same fast-moving SKU. Two transactions that both read "10 available" and both reserve 10 would oversell. The allocation plan (ADR-0010) is computed in application code from several candidate rows, so a single `UPDATE … WHERE available >= n` cannot express it. How do we make concurrent allocation correct without making it slow or deadlock-prone?

## Decision drivers

- Zero oversell under any interleaving (QA-C1).
- Bounded latency and no livelock on hot SKUs.
- No deadlocks between allocators.
- Simple to reason about and test.

## Considered options

1. **Pessimistic locking:** one `SELECT … FOR UPDATE OF sb ORDER BY sku_id, id` that locks every candidate row before planning, at READ COMMITTED.
2. **Optimistic versioning:** read candidates without locks, plan, then `UPDATE … WHERE version = $v` for each row and retry the whole plan on any conflict.
3. **SERIALIZABLE isolation:** plain reads, let PostgreSQL's SSI abort conflicting transactions, retry on 40001.
4. Advisory lock per SKU (`pg_advisory_xact_lock(hash(sku))`).

## Decision outcome

Chosen option: **1**. `lockCandidates` (`apps/api/src/modules/allocation/allocation.repository.ts`) runs one statement:

```sql
SELECT … FROM stock_balances sb
  JOIN bins b  ON b.id = sb.bin_id AND b.is_active
  JOIN zones z ON z.id = b.zone_id AND z.zone_type = ANY('{STORAGE,PICK}')
  JOIN lots l  ON l.id = sb.lot_id
 WHERE sb.organization_id = $1 AND sb.warehouse_id = $2 AND sb.sku_id = ANY($3)
   AND sb.on_hand > sb.allocated
 ORDER BY sb.sku_id, sb.id
 FOR UPDATE OF sb
```

- **Ordered acquisition** — rows are locked in `(sku_id, id)` order and the SKU array is sorted, so any two allocators acquire overlapping locks in the same global order and cannot deadlock with each other.
- **Re-evaluation** — at READ COMMITTED, a transaction that blocks on a locked row re-checks the `WHERE` clause against the newly committed version when the lock is released (PostgreSQL's EvalPlanQual). A row the winner fully allocated no longer satisfies `on_hand > allocated` and drops out; a partially allocated row is returned with its fresh `available`. The loser therefore plans against current truth.
- **Only `sb` is locked** — `FOR UPDATE OF sb` avoids locking bins, zones and lots, so topology reads and lot upserts are not blocked.
- **Backstop** — `CHECK (allocated <= on_hand)` on `stock_balances` turns any logic bug into a 409 `CONSTRAINT_VIOLATION` rather than an oversell.
- Planning and persisting happen in the same transaction; `appendMovement` re-locks the rows it updates (already held, so no extra wait).

### Why not the alternatives

| Option                | Problem for this workload                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optimistic versioning | On a hot SKU most attempts conflict; retries replan the whole order and latency becomes unbounded (livelock risk). The `version` column exists on `stock_balances` and is incremented on every update, but it is informational. |
| SERIALIZABLE          | Correct, but aborts surface as 40001 under contention; every caller needs a retry loop, and predicate locks on range scans increase false-positive aborts.                                                                      |
| Advisory lock per SKU | Serialises a SKU just like option 1, but is invisible to writers that do not take it (moves, adjustments), so stock rows would still need row locks: two locking mechanisms instead of one.                                     |

### Consequences

- Good: the concurrency test (12 racing ship-complete orders for 39 units) yields exactly 7 successes and 5 `INSUFFICIENT_STOCK`, with `allocated = 35` and a consistent projection.
- Good: waiting is FIFO on the row lock; no retries in the common case.
- Bad: allocators for the same SKU serialise for the duration of the transaction; transactions must stay short (no network calls inside, ADR-0003 helps).
- Bad: other writers lock balance rows in a different order: `appendMovement` sorts by the string key `bin|sku|lot`, and release walks picks in line order. A deadlock between, for example, a move and an allocation is therefore possible though rare; PostgreSQL detects it within `deadlock_timeout` and the victim receives `503 CONCURRENCY_RETRY`. Unifying lock order across all writers and measuring the retry rate is part of SP-181.
