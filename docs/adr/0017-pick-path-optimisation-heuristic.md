# ADR-0017: Pick path optimisation heuristic

- **Status:** Proposed
- **Date:** 2026-11
- **Tickets:** SP-100; depends on SP-093; follow-up SP-102

## Context and problem statement

Travel is typically 50–60% of a picker's time. Once waves release pick tasks (SP-093), each picker route visits a set of bins. Finding the shortest route is a travelling-salesman problem restricted to a warehouse graph (aisles, cross-aisles, depot). Exact solvers are too slow for interactive release of hundreds of routes, and the serpentine `pick_sequence` (ADR-0014) ignores cross-aisles and skips nothing. Which routing method should StockPilot use?

## Decision drivers

- Route quality within ~10% of optimal on typical single-block and two-block layouts.
- Release of a 300-task wave in under 1 s on the reference host.
- Deterministic results (operators compare routes).
- Pure function in `packages/shared`, testable without a database, consistent with ADR-0010.
- No external solver library or service (ADR-0003).

## Considered options

1. **Layout-aware construction + local search:** build a distance matrix on the aisle graph, construct with S-shape and largest-gap, pick the shorter, then improve with 2-opt bounded by iterations and time.
2. Pure S-shape (traverse every aisle that contains a pick).
3. Exact dynamic programming (Ratliff–Rosenthal) for single-block layouts.
4. Generic metaheuristic (simulated annealing / genetic algorithm).

## Decision outcome

Proposed option: **1**.

- **Model.** Bins carry `(aisle, rack, level, position)` from their code (ADR-0014) plus planned per-zone layout metadata (aisle length, cross-aisle positions, depot) from SP-023. Distance between two bins is Manhattan distance along aisles and cross-aisles; vertical level adds a configurable penalty, not travel.
- **Construction.** Compute both an S-shape route (enter every aisle with a pick and traverse fully, alternating direction; leave the last aisle by the shorter end) and a largest-gap route (enter each aisle from both ends up to the largest gap between consecutive picks). Keep the shorter.
- **Improvement.** 2-opt over the constructed tour on the precomputed matrix; stop when no improving swap exists, after `k` passes, or after a time budget (default 50 ms per route).
- **Complexity.** For p picks: matrix O(p^2); S-shape and largest-gap O(p log p); each 2-opt pass O(p^2), bounded passes. For typical p <= 60 this is well under 5 ms.
- **Output.** An ordered list of task IDs with cumulative distance, persisted on `pick_tasks.sequence_no` at wave release; the API `POST /api/v1/pick-paths` (currently 501) exposes it for preview.

Rejected: pure S-shape is the baseline and fallback only; exact DP covers single-block layouts but not multi-block or zone-hopping routes; metaheuristics are non-deterministic unless seeded and harder to bound in time.

### Consequences

- Good: measurable improvement over the serpentine default; deterministic and testable against hand-solved fixtures and the DP optimum on small single-block instances.
- Good: graceful degradation — without layout metadata, routing falls back to `pick_sequence` order.
- Bad: needs layout metadata that does not exist yet (SP-023).
- Bad: one-way aisles, congestion and picker interference are not modelled.
- Open question: batch/cluster picking (SP-102) routes several orders at once; the same engine applies with merged pick sets.
