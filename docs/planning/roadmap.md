# Roadmap

Milestones group the tickets in [backlog.md](backlog.md), which is the canonical list for
estimates, status and dependencies. The order follows the physical flow of goods: first make
stock trustworthy (M0-M1), then move it in (M2), commit it to orders (M3), get it out of the
building (M4-M5), keep it accurate (M6), and widen the business model (M7) and the operational
envelope (M8).

| Milestone | Theme                              | Tickets |    Hours | Status             |
| --------- | ---------------------------------- | ------: | -------: | ------------------ |
| M0        | Platform & identity foundation     |      11 |       60 | **done**           |
| M1        | Trustworthy stock (first slice)    |      11 |      106 | **done**           |
| M2        | Inbound, receiving & putaway       |      17 |      274 | planned            |
| M3        | Orders, waves & smarter allocation |       7 |      140 | planned            |
| M4        | Picking & pick paths               |       4 |      116 | planned            |
| M5        | Packing, cartonization & shipping  |       7 |      148 | planned            |
| M6        | Inventory accuracy & replenishment |      12 |      220 | planned            |
| M7        | 3PL, serials, returns & labels     |       9 |      204 | planned            |
| M8        | Operations, scale & hardening      |      14 |      292 | planned            |
| **Total** |                                    |  **92** | **1560** | 166 h done (10.6%) |

## M0: Platform & identity foundation (done)

**Goal:** a secure, observable, multi-tenant shell that every later feature plugs into.

**Tickets:** SP-001 monorepo tooling · SP-002 config loader and logging · SP-003 envelope,
request ids, health/ready · SP-004 forward-only migration runner · SP-005 CI on the runner's
native PostgreSQL · SP-006 `run.sh` · SP-010 register/login/logout/me · SP-011 Postgres
sessions and CSRF · SP-012 auth throttling and `TRUST_PROXY` · SP-013 RBAC skeleton ·
SP-014 audit write path.

**Exit criteria (met):**

- `./run.sh setup` works on a fresh clone against local PostgreSQL. CI runs lint, format,
  typecheck, tests with coverage thresholds, build and a migrate+seed smoke test, all green.
- Registration does not reveal existing accounts. Login is throttled per email, per IP and per
  distinct-email fan-out, and is burst-safe. Production refuses to start without an explicit
  `TRUST_PROXY`.
- Every response uses the envelope and carries a request id. Every pending route answers 501
  with its ticket.

## M1: Trustworthy stock, the first vertical slice (done)

**Goal:** stock quantities can be trusted, end to end, under concurrency.

**Tickets:** SP-020 warehouses/zones/bins with bin-code validation and pick sequence ·
SP-030 SKUs with nested UoM ladders · SP-031 lots, expiry and auto lots · SP-040
event-sourced movement ledger · SP-041 on-hand projection with replay verification · SP-050
FEFO/FIFO/LIFO allocation engine · SP-051 concurrency-safe allocation API · SP-055 release
with compensating entries · SP-060 web shell · SP-061 stock and allocation screens ·
SP-062 demo seed.

**Exit criteria (met):**

- No oversell: 12 concurrent ship-complete orders racing for 39 units allocate exactly 35, and
  verify stays consistent (`allocation.db.test.ts`).
- The ledger is append-only (enforced by a trigger), and replaying it equals the projection.
  Injected drift is detected.
- UoM conversion is exact and never rounds. Randomised property tests cover ladders, ledger
  conservation and the allocation engine.
- Operators can receive, move and allocate from the UI. Planned sections are visible with
  ticket badges.

## M2: Inbound, receiving & putaway

**Goal:** stock arrives against an ASN, is inspected, and is put away to a bin that physically
fits it.

**Tickets:** SP-009 email-verified signup via local outbox · SP-015 user invitations and
management · SP-017 password reset via local outbox · SP-021 topology CSV import · SP-022 bin
weight/volume capacity enforcement · SP-024 warehouse/zone/bin update and deactivation ·
SP-033 SKU import/export · SP-034 item dimensions, weight, hazmat, temperature class · SP-035
SKU update and UoM ladder versioning · SP-042 inventory status and holds · SP-070 ASN creation
and import · SP-071 receiving against ASN with discrepancies · SP-072 mobile receiving scanner
flow · SP-073 quality inspection and quarantine · SP-080 directed putaway rules engine ·
SP-081 putaway task execution · SP-173 local outbox and in-app notifications.

**Exit criteria:**

- An ASN can be received line by line with over, short and damaged quantities. Closing it
  produces a discrepancy report, and every unit received is a ledger `RECEIPT`.
- Putaway suggestions never exceed a bin's weight or volume capacity, and confirmation appends
  a `MOVE`.
- Held lots (quarantine, damaged, QA) can never be allocated (already a domain rule; now
  driven by holds).
- Changing a UoM ladder never changes the meaning of historical quantities (ladders are
  versioned).
- No outbound email: verification, invitation and reset messages go to the local outbox table.

## M3: Orders, waves & smarter allocation

**Goal:** real outbound orders flow through a state machine and are released in waves that
meet carrier cut-offs.

**Tickets:** SP-052 allocation rules per client/SKU class · SP-053 pick-face vs reserve aware
allocation (full-case rules) · SP-054 backorders and allocation retry queue · SP-090 order
intake (API and CSV) · SP-091 order lifecycle state machine · SP-092 wave planning by
cut-off and zone · SP-093 wave release and pick task creation.

**Exit criteria:**

- Orders move only through legal state transitions (property tested), and cancelling releases
  the allocation.
- Full-case quantities are allocated from reserve and eaches from pick faces, and the plan
  remains no-oversell under the M1 concurrency test.
- Short orders become backorders and are retried automatically when stock arrives.
- Wave release creates a pick task for every allocated pick.
- Note: SP-052 depends on SP-018 (3PL clients, M7). Ship the SKU-class rules in M3 and the
  per-client rules once SP-018 lands.

## M4: Picking & pick paths

**Goal:** pickers walk short, correct routes and short picks never corrupt stock.

**Tickets:** SP-100 pick path optimisation (S-shape / largest-gap / 2-opt) · SP-101 pick
task execution and short-pick handling · SP-102 batch and cluster picking · SP-103 picker
mobile UI.

**Exit criteria:**

- On benchmark layouts the optimised route is at least 15% shorter than plain pick-sequence
  order. A route for 100 locations is computed in under 200 ms at p95.
- Pick confirmation is scan-verified (bin and lot). A short pick posts an adjustment and
  re-allocates the remainder in one transaction.
- The picker UI works one-handed on a phone-sized screen.

## M5: Packing, cartonization & shipping

**Goal:** orders leave in the right boxes with correct documents, and on-hand stock drops only
when they ship.

**Tickets:** SP-110 carton type catalogue · SP-111 3D cartonization heuristic · SP-112 pack
station UI with scan verification · SP-120 shipments and manifests · SP-121 local carrier rate
tables · SP-122 packing list and bill of lading · SP-123 ship confirmation and inventory
decrement.

**Exit criteria:**

- Cartonization never produces overlapping or out-of-bounds placements or overweight cartons
  (property tested). Average fill ratio beats the "largest box" baseline on a reference order set.
- Ship confirmation decrements on-hand and allocated together. Verify remains consistent.
- Carrier rates come from local tables, with no external calls.

## M6: Inventory accuracy & replenishment

**Goal:** stock stays accurate over time, history can be queried, and pick faces stay full.

**Tickets:** SP-043 point-in-time stock by replay · SP-044 ledger snapshots and compaction ·
SP-045 adjustment approval workflow · SP-082 ABC velocity slotting · SP-130 cycle count
planning · SP-131 blind count execution · SP-132 variance approval and posting · SP-140
min/max replenishment rules · SP-141 replenishment tasks · SP-142 demand-based replenishment ·
SP-171 inventory reports (aging, expiry exposure, velocity) · SP-172 ledger CSV export.

**Exit criteria:**

- Replay from the latest snapshot gives the same result as a full replay (differential test),
  and point-in-time queries over 12 months of ledger answer in under 2 s.
- Blind counts hide system quantities. Variances above threshold need approval and post as
  `ADJUST_IN`/`ADJUST_OUT`.
- Replenishment tasks are raised before a pick face runs dry in the reference simulation.

## M7: 3PL, serials, returns & labels

**Goal:** serve multiple clients from one warehouse, track serialised goods, take returns and
print labels in-house.

**Tickets:** SP-016 custom role editor · SP-018 3PL client accounts and client-scoped
inventory · SP-032 serial number tracking · SP-150 RMA authorisation · SP-151 returns
receiving and disposition · SP-160 in-house Code128 SVG encoder · SP-161 label templates ·
SP-162 license plates (LPN) and nested handling units · SP-174 3PL storage and handling billing.

**Exit criteria:**

- A client user sees only that client's stock (tenancy tests extended to the client scope).
- The Code128 output decodes correctly with standard scanners for every test vector. No
  third-party barcode service is used.
- Monthly storage billing is reproducible from the ledger, in integer minor units.

## M8: Operations, scale & hardening

**Goal:** production-grade operations: observability, performance evidence, security review,
accessibility, and a path beyond a single instance.

**Tickets:** SP-019 audit log browser and export · SP-023 warehouse map (SVG) · SP-170
operations dashboard · SP-180 metrics endpoint · SP-181 load testing allocation and ledger ·
SP-182 backup/restore drill automation · SP-183 security hardening (Postgres-backed throttles,
ASVS L2 review) · SP-190 Postgres-backed shared throttle store for multi-instance deployments ·
SP-184 accessibility audit · SP-185 end-to-end suite across critical flows · SP-186 ledger
partitioning by month · SP-187 offline-tolerant scanner PWA · SP-188 labour tracking ·
SP-189 dock appointment scheduling.

**Exit criteria:**

- Load test: allocation p95 under 150 ms at 50 concurrent allocators on a hot SKU, with no
  oversell and a `CONCURRENCY_RETRY` rate under 0.5%.
- SP-183 and SP-190 are done, so two API instances behind nginx enforce one shared set of
  throttles (the single-instance constraint in deployment.md is lifted).
- An automated restore drill ends with `projection/verify` returning `consistent: true`.
- WCAG 2.2 AA on every live screen. The E2E suite runs in CI.
- Monthly ledger partitions with no change to replay results.
