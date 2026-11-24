# ADR-0009: Event-sourced inventory ledger with synchronous projection

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-040, SP-041; follow-ups SP-043, SP-044, SP-186

## Context and problem statement

Inventory is the most disputed data in a warehouse: auditors, 3PL clients and finance all ask "why is the count 37?". Overwriting a quantity column loses that answer. At the same time, operators need instant, correct stock-on-hand by bin, and allocation needs a lockable row per `(bin, sku, lot)`. How should stock state be stored?

## Decision drivers

- Full, immutable history of every quantity change with actor, reason, reference and correlation.
- Read-your-writes: the stock screen and the next allocation must see a receipt immediately.
- A single lockable row per stock position for concurrency control (ADR-0011).
- Ability to prove the current state is correct and to rebuild it.

## Considered options

1. Append-only `inventory_movements` ledger as source of truth + `stock_balances` projection updated **synchronously in the same transaction**.
2. Ledger + asynchronous projection built by a background consumer (eventual consistency).
3. Mutable balances table with a separate, best-effort history table.
4. Ledger only; compute balances on read with `SUM`.

## Decision outcome

Chosen option: **1**. Movement types are `RECEIPT`, `MOVE`, `ADJUST_IN`, `ADJUST_OUT`, `ALLOCATE`, `DEALLOCATE`. Quantities are always positive; direction comes from the type and which of `from_bin_id` / `to_bin_id` is set. The pure function `effectsOf(movement)` expands each movement into one or two balance effects (`ON_HAND_IN`, `ON_HAND_OUT`, `ALLOCATE`, `DEALLOCATE`), and `applyEffect` enforces `on_hand >= 0` and `allocated <= on_hand`. `appendMovement` (the single writer) locks the affected balance rows, applies effects in pure code, inserts the movement and updates the rows — all in the caller's transaction. Commands that write several movements share a `correlation_id`. `projectBalances` folds any ordered movement sequence (by `id`) into balances in O(m); `GET /inventory/projection/verify` compares that fold with the stored projection using `diffBalances`.

Allocation is recorded in the ledger (`ALLOCATE`/`DEALLOCATE`), not only in `allocation_picks`, so the `allocated` column is also a pure function of the ledger.

### Consequences

- Good: complete audit trail; any balance can be explained by listing movements for its key.
- Good: strong consistency for reads and allocation with no projection lag.
- Good: drift is detectable; the projection is disposable and can be rebuilt by replay.
- Bad: every write pays for the ledger insert plus projection update (two to five statements).
- Bad: verification and future rebuild are O(m) in ledger size and currently load an organisation's whole ledger in memory; snapshots (SP-044) and monthly partitions (SP-186) bound this.
- Neutral: future movement types (holds, pick to staging, ship, count variance) extend the enum and `effectsOf`; the compiler's exhaustiveness check finds every place to update.
