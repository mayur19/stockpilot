# ADR-0014: Bin addressing scheme and serpentine default pick sequence

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-020; follow-ups SP-021, SP-023, SP-100

## Context and problem statement

Bin codes are printed on labels, scanned by operators and sorted by software. If they are free text, nothing can be inferred from them (aisle, level), sorting gives nonsensical walk orders, and typos create phantom locations. Allocation also needs a cheap "walk order" to break ties and to sequence picks before the real pick-path optimiser exists (SP-100).

## Decision drivers

- Human-readable, scannable, and parseable into structure.
- Support unstructured locations (docks, staging lanes, cages).
- A default walk order available without a warehouse map.

## Considered options

1. Structured code `ZONE-AA-RR-L-P` with a free-form fallback for unstructured locations; `pick_sequence` derived as a serpentine number and overridable.
2. Free-form codes with manual `pick_sequence` for every bin.
3. Coordinates (x, y, z) per bin from a CAD import.

## Decision outcome

Chosen option: **1** (`packages/shared/src/domain/bin-code.ts`).

- Structured: zone 1–4 alphanumerics starting with a letter, aisle `01–99`, rack/bay `01–99`, level `0–9` (0 = floor), position `A–Z`, e.g. `A-03-12-2-B`. Aisle and rack `00` are rejected.
- Free-form: one token of 2–16 alphanumerics starting with a letter (`RCV01`, `DOCK1`, `QCAGE1`), parsed with `structured: false`.
- Codes are trimmed and upper-cased; `(warehouse_id, code)` is unique.
- `defaultPickSequence` = `aisle * 100000 + rackOrder * 1000 + level * 100 + positionIndex`, where `rackOrder = rack` on odd aisles and `100 - rack` on even aisles. Sorting by it walks up aisle 1, down aisle 2, up aisle 3 — an S-shape traversal. Free-form bins get 0. Clients may override `pickSequence` on creation.

### Consequences

- Good: allocation tie-breaks and pick lists follow a sensible walk without any map data.
- Good: invalid codes are rejected at creation with `400 INVALID_BIN_CODE`.
- Bad: the scheme assumes up to 99 aisles and racks and 26 positions; larger sites need a wider format (handled by the bulk import in SP-021 with a configurable pattern).
- Bad: serpentine ordering ignores cross-aisles and the depot location; SP-100 replaces it with distance-based routing (ADR-0017).
- Neutral: the zone segment of a structured code is not yet cross-checked against the zone the bin is created in.
