# ADR-0018: Cartonization heuristic

- **Status:** Proposed
- **Date:** 2026-11
- **Tickets:** SP-111; depends on SP-034, SP-110; follow-ups SP-112, SP-121

## Context and problem statement

At pack-out, the system should recommend which carton types to use and which items go in each, minimising shipping cost (dimensional weight) and void fill while respecting weight limits and handling rules (hazmat, fragile, temperature class). Three-dimensional bin packing is NP-hard; exact solvers do not fit a pack station's interactive budget. Which algorithm should StockPilot use?

## Decision drivers

- Recommendation in < 200 ms for orders up to 50 units and 10 carton types.
- Never recommend an infeasible packing (item does not fit, weight exceeded).
- Explainable result (operators must be able to follow it at the pack bench).
- Pure, deterministic function in `packages/shared`; no external solver (ADR-0003).
- Integer geometry in millimetres and grams, consistent with ADR-0008.

## Considered options

1. **Extreme-point first-fit-decreasing** with six axis-aligned orientations, carton selection by smallest feasible carton, then repack to reduce carton count.
2. Volume-only heuristic (sum of item volumes x fill factor).
3. Layer-building / wall-building heuristic.
4. Exact integer programming or branch-and-bound.

## Decision outcome

Proposed option: **1**.

1. **Pre-checks.** Each unit needs dimensions and weight (SP-034). Units that fit no carton type in any orientation are reported as `SHIP_IN_OWN_BOX`. Incompatible classes (e.g. hazmat with food) are partitioned into separate groups first.
2. **Sort** units by volume descending, then longest edge descending (FFD).
3. **Place** each unit at the first feasible **extreme point** of an open carton: try the six orientations, accept the first that stays inside the carton, does not overlap placed boxes (axis-aligned box intersection) and keeps total weight within `max_weight_g`. Placing a box creates up to three new extreme points.
4. **Open a carton** when no open carton fits: choose the smallest carton type (by volume, then cost) that can hold the unit.
5. **Improve.** For each carton, try repacking its contents into a smaller carton type; try merging the two least-full cartons. Keep changes that reduce total dimensional weight.
6. **Complexity.** n units, c carton types, e extreme points per carton (O(n)): placement O(n · e · 6 · n) = O(n^3) worst case, small in practice for n <= 50; the improvement step multiplies by c.

Output: cartons with type, ordered contents, placements (x, y, z, orientation), fill ratio, total weight and dimensional weight, persisted with the pack session (SP-112).

### Consequences

- Good: feasibility is guaranteed by construction; results are deterministic and explainable as "largest first, first corner that fits".
- Good: typical fill rates of 70–85% for mixed e-commerce orders, a large gain over volume-only estimates which often recommend cartons that cannot physically close.
- Bad: no support for item nesting, deformable goods (apparel bags) or load-bearing limits beyond total weight; deformable items can be modelled with a "soft" flag that relaxes one dimension.
- Bad: depends on accurate item master data (SP-034); poor data gives poor recommendations, so the pack UI always allows override.
- Open question: whether to cost cartons with local carrier rate tables (SP-121) directly in the objective rather than by dimensional weight alone.
