# ADR-0010: Allocation engine as a pure function

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-050, SP-051; follow-ups SP-052, SP-053, SP-054

## Context and problem statement

Allocation decides which physical units (bin + lot) are promised to an order line. It encodes business policy (FEFO for perishables, FIFO or LIFO otherwise), safety rules (never promise expired, held or short-dated stock) and efficiency goals (fewest pick touches). Mixing this logic with SQL and locking makes it untestable and hard to reason about under concurrency. Where and how should allocation logic live?

## Decision drivers

- Exhaustive unit testing of strategy, eligibility and pick minimisation without a database.
- Deterministic output for the same input (reproducible support cases).
- Planning must operate on a locked, stable snapshot (ADR-0011).
- Multi-line orders for the same SKU must not double-count stock.

## Considered options

1. Pure function `planAllocation(request, candidates)` in `packages/shared`, fed with rows already locked by the API; `planOrderAllocation` for whole orders with a shared pool.
2. Allocation in SQL (window functions with running totals) inside one statement.
3. Stored procedure in plpgsql.

## Decision outcome

Chosen option: **1** (`packages/shared/src/domain/allocation.ts`).

1. **Eligibility filter** — each candidate is excluded with a reason: `NO_AVAILABLE` (available <= 0), `ON_HOLD`, `EXPIRED` (expiry <= today, in the warehouse time zone), `SHORT_SHELF_LIFE` (expiry < today + `minShelfLifeDays`). Exclusions are returned for explainability.
2. **Strategy ordering** — `compareByStrategy`: FEFO sorts by expiry ascending with non-perishable lots last, then receipt time; FIFO by receipt time ascending; LIFO descending; lot code breaks ties so ordering is total.
3. **Rank groups** — candidates the strategy ranks equally form a group, consumed in order. Because the lot code is the final tie-breaker and is unique per SKU, a group is in practice "every bin holding the same lot". Strategy is never violated to save a pick: a younger lot is never touched while an eligible older lot (FIFO) or earlier-expiring lot (FEFO) still has stock.
4. **Pick minimisation inside a group** — if one bin can cover the remainder, take the **smallest** covering bin (best fit, keeps larger quantities intact for full-case/pallet picks); otherwise drain **largest first**; ties by pick sequence then bin code.
5. **Fill-or-kill** — when `allowPartial` is false and there is a shortfall, the plan is `NONE` with no picks.

`planOrderAllocation` plans lines in order, subtracting units consumed by earlier lines from the same `(bin, lot)` before planning the next; `shipComplete` makes the whole order all-or-nothing. Complexity: O(n log n) per line for n candidates.

### Consequences

- Good: `packages/shared/test/allocation.test.ts` covers strategies, exclusions, best fit, ties and multi-line pools at 90%+ coverage without I/O.
- Good: the API layer is a thin "lock -> plan -> persist" sequence that is easy to review for concurrency.
- Good: exclusion reasons are returned to the UI so planners can see why stock was skipped.
- Bad: candidates must be loaded into memory; for SKUs with thousands of stock rows the locking query touches them all. Pick-face versus reserve rules (SP-053) will narrow the candidate set.
- Bad: global optimisation across orders (e.g. wave-level best fit) is out of scope; orders are planned one at a time in arrival order.
