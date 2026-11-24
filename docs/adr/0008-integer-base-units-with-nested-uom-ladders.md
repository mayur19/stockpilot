# ADR-0008: Quantities as integer base units with nested UoM ladders

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-030; follow-up SP-035

## Context and problem statement

Warehouses receive pallets, store cases, pick inner packs and ship eaches. The same SKU is counted in different units at different steps: "1 PL", "20 CS", "6 IP", "30 EA". If quantities are stored in mixed units or as decimals, rounding creeps in (0.0833 of a case), conversions disagree, and the ledger fold stops being exact. How should quantities and units be represented?

## Decision drivers

- Exact arithmetic: summing millions of movements must never drift.
- Conversions must reject impossible requests ("18 EA as cases of 12") instead of rounding.
- Mirrors physical packaging: a pallet holds whole cases.
- Fits safely in JavaScript numbers and PostgreSQL `bigint`.

## Considered options

1. Store every quantity as an integer count of the SKU's base unit; units are a per-SKU **nested ladder** where each level is a whole multiple of the level below.
2. Decimal quantities (`numeric`) in the unit the user entered, with a conversion table.
3. Free-form conversion graph (any unit to any unit with arbitrary factors, including non-nested ones such as 12-packs and 8-packs side by side).

## Decision outcome

Chosen option: **1**. `createUomLadder(baseUom, levels)` (`packages/shared/src/domain/uom.ts`) sorts levels by factor and rejects invalid codes, duplicates, factors < 2, factors above `MAX_QUANTITY`, and any factor that is not a strict whole multiple of the previous level. `toBaseUnits` multiplies with overflow checks; `convertQuantity` throws `NON_INTEGRAL_CONVERSION` rather than rounding; `breakdownQuantity` greedily decomposes a base quantity into the largest levels first (1000 EA -> 2 PL + 3 CS + 4 EA for CS=12, PL=480), which is exact and minimal **because** the ladder is nested. `MAX_QUANTITY = 10^12` keeps every intermediate sum far below `Number.MAX_SAFE_INTEGER`, and the `pg` int8 parser converts `bigint` to `number` safely under that bound. The ladder is stored on the SKU as `uom_levels jsonb`.

### Consequences

- Good: the ledger, projection and allocation engine work purely in integers; UoM never enters the hot path.
- Good: greedy breakdown is optimal, O(levels), and drives the "2 PL + 3 CS + 4 EA" display.
- Bad: non-nested packaging (a SKU sold in both 6-packs and 8-packs) cannot be modelled; such SKUs use the least common unit as a level or a separate SKU.
- Bad: changing a ladder after stock exists would reinterpret history; SKU update with ladder versioning is deferred to SP-035 and ladders are immutable until then.
- Neutral: catch-weight items (variable kg per case) are out of scope.
