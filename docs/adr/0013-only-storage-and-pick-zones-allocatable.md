# ADR-0013: Only STORAGE and PICK zones are allocatable

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-020, SP-051; follow-ups SP-042, SP-053, SP-073

## Context and problem statement

Stock physically sits in many places: on the receiving dock before putaway, in a quarantine cage awaiting QA, in staging lanes after picking, at the shipping door. Not all of it can be promised to a new order. Receiving-dock stock may not have been checked; quarantined stock may be rejected; staged stock already belongs to another shipment. Which stock is eligible for allocation?

## Decision drivers

- Never promise stock that cannot be picked or might be rejected.
- Simple, explainable rule that operators understand from the zone name.
- Avoid adding a per-bin flag that drifts from reality.

## Considered options

1. Allocation eligibility by **zone type**: only `STORAGE` and `PICK` zones.
2. A boolean `allocatable` flag per bin.
3. Everything is allocatable; rely on lot holds.

## Decision outcome

Chosen option: **1**. Zones have `zone_type IN ('RECEIVING','STORAGE','PICK','STAGING','SHIPPING','QUARANTINE')`. `ALLOCATABLE_ZONE_TYPES = ['STORAGE','PICK']` is applied in the candidate locking query, together with `bins.is_active`. Stock received into `RCV01` becomes allocatable only once it is moved (put away) into storage or pick; stock in `QCAGE1` is never allocated even if its lot is not on hold.

### Consequences

- Good: receiving-dock and quarantine stock is visible in stock-on-hand but cannot be promised; the seed data demonstrates both.
- Good: the rule is a single constant and one SQL predicate.
- Bad: a site that wants to cross-dock directly from receiving needs a future exception (planned as a cross-dock zone type alongside SP-071).
- Neutral: pick-face versus reserve preference (full-case from reserve, eaches from pick) is a ranking concern handled in SP-053, not an eligibility one.
