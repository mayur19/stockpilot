# StockPilot — Product Requirements Document

|                |                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product        | StockPilot, a warehouse management system (WMS) for third-party logistics (3PL) and multi-warehouse operators                                                                                                            |
| Document owner | Product                                                                                                                                                                                                                  |
| Status         | Living document; reflects the code at the end of milestone M1                                                                                                                                                            |
| Related        | [requirements.md](requirements.md), [user-stories.md](user-stories.md), [requirements-traceability.md](requirements-traceability.md), [../planning/backlog.md](../planning/backlog.md), [../glossary.md](../glossary.md) |

## 1. Vision

Every unit in every bin is accounted for, every promise made to a customer is backed by stock that physically exists and is fit to ship, and every change to inventory can be explained after the fact.

StockPilot puts an **append-only movement ledger** at the centre of warehouse operations. Receiving, putaway, moves, adjustments, allocation, picking and shipping are all expressed as ledger movements. Stock-on-hand is a projection of that ledger, so it can be checked against a full replay at any time. On top of that sit the processes a 3PL needs to run a building: ASN receiving, directed putaway, FEFO/FIFO/LIFO allocation without overselling, wave planning, optimised pick paths, cartonization, shipping, cycle counting, replenishment, returns, labels and client billing.

## 2. Problem

Small and mid-sized 3PLs (1–10 sites, 5k–200k SKUs, 500–20,000 order lines a day) usually run on one of three things: spreadsheets, a module bolted onto an ERP, or an enterprise WMS they cannot afford to configure. The same failures come up again and again:

| Problem                                                                                                             | Operational consequence                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Overselling under concurrency.** Two orders read the same "available" figure and both get promised the last case. | Short picks on the floor, split shipments, chargebacks from retail customers.            |
| **Silent stock drift.** Balances are edited in place with no movement history.                                      | Nobody can say _why_ a bin is wrong; a full physical count is the only fix.              |
| **Expiry blindness.** Allocation ignores expiry or uses receipt date only.                                          | Short-dated or expired product ships to customers with shelf-life contracts; write-offs. |
| **UoM confusion.** "10" means 10 eaches to one person and 10 cases to another.                                      | Over- and under-receipts that are out by 12× or 480×, found weeks later.                 |
| **Walk-heavy picking.** Pick lists are sorted by SKU, not by location.                                              | Pickers spend most of their shift walking.                                               |
| **Over-boxing.** Packers choose cartons by eye.                                                                     | Dimensional-weight surcharges and wasted void fill.                                      |
| **Opaque 3PL billing.** Storage and handling charges are rebuilt by hand each month.                                | Revenue leakage and billing disputes with clients.                                       |

## 3. Personas

| Persona                         | Role in StockPilot                             | Goals                                                                                                  | Pain today                                                              |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Wendy, warehouse manager**    | `manager`                                      | Hit carrier cut-offs, keep labour productive, know the state of the building at a glance.              | Finds out about shortages at the pick face; no single view of backlog.  |
| **Ravi, receiving clerk**       | `operator`                                     | Get trucks off the dock fast and put correct quantities, lots and expiries into the system first time. | Keys quantities in the wrong unit; ASN mismatches are handled on paper. |
| **Paula, picker**               | `operator`                                     | Short walks, clear instructions, a simple way to report a short pick.                                  | Pick lists in SKU order; "phantom stock" in bins.                       |
| **Ivan, inventory controller**  | `manager` (adjust, audit)                      | Accurate bin-level stock, explainable variances, controlled adjustments.                               | Cannot trace who changed what; counts reveal drift with no history.     |
| **Amara, 3PL account manager**  | `viewer` today; client-scoped role from SP-018 | Show clients accurate stock and expiry exposure; bill storage and handling correctly.                  | Builds client reports and invoices by hand from spreadsheets.           |
| **Omar, administrator / owner** | `owner` / `admin`                              | Set up sites, zones and bins; manage users; trust the system's security.                               | Shared logins; no throttling or audit; topology kept in spreadsheets.   |

## 4. Goals and non-goals

### 4.1 Goals

1. **G1 — Never oversell.** Concurrent allocation must never reserve more units than are available in a bin/lot (enforced in the domain, by ordered row locks, and by a database CHECK constraint).
2. **G2 — Explainable inventory.** Every change to stock is an immutable ledger movement with actor, reason, reference and correlation ID; the on-hand projection can be verified against a full replay on demand.
3. **G3 — Ship fit-for-purpose stock.** Allocation honours FEFO/FIFO/LIFO, never promises expired lots, respects minimum remaining shelf life, and skips held stock and non-allocatable zones.
4. **G4 — Exact UoM math.** Quantities are stored as whole base units; pack-level conversions are exact or rejected, never rounded.
5. **G5 — Efficient floor execution** (M3–M5). Waves by carrier cut-off, optimised pick paths, cartonization, scan-verified packing.
6. **G6 — 3PL-ready** (M7). Client-scoped inventory, per-client allocation rules and storage/handling billing.
7. **G7 — Secure by default.** Session-based authentication with CSRF protection, RBAC, non-enumerating registration, layered login throttling and a full audit trail.

### 4.2 Non-goals

- **Transportation management** (route planning, fleet, freight audit). StockPilot produces manifests and uses local rate tables only.
- **Live carrier API integrations** in the first release; labels and manifests are produced in-house (Code128 SVG).
- **Financial accounting / inventory valuation** (FIFO cost layers, GL postings). Ledger quantities only; billing (SP-174) produces chargeable quantities, not invoices in an accounting system.
- **Warehouse automation control** (conveyors, sorters, AS/RS, pick-to-light hardware).
- **Demand forecasting** beyond the moving-average demand used for replenishment (SP-142).
- **Native mobile apps.** Scanner flows are responsive web, later an offline-tolerant PWA (SP-187).
- **Multi-currency, tax, or EDI X12/EDIFACT translation.** ASNs and orders arrive as JSON or CSV.

## 5. Scope

### 5.1 Implemented slice (M0 + M1, 166 of 1,560 estimated hours, 10.6%)

| Area              | What works today                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tickets                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Platform          | Strict TypeScript monorepo, Zod-validated configuration, structured logs with request IDs, standard `{data, error, meta}` envelope, health/readiness, forward-only checksummed migrations, CI on the runner's native PostgreSQL, `run.sh` launcher, demo seed.                                                                                                                                                                                                                              | SP-001…SP-006, SP-062   |
| Identity & access | Owner registration (202, non-enumerating, no session issued), login/logout/me, Postgres-backed sessions with HMAC-stored IDs, CSRF double-submit, per-email progressive backoff with synchronous attempt reservation, per-IP spraying limiter and distinct-email caps per IPv6 /64 and /48, per-IP registration limiter, bounded throttle stores (a force-evicted active lock-out is kept in a count-min sketch), `TRUST_PROXY` (explicit in production), five-role RBAC, audit write path. | SP-010…SP-014           |
| Topology          | Warehouses with canonical IANA time zones; typed zones; bins with validated `ZONE-AA-RR-L-P` codes, serpentine default pick sequence, optional weight/volume limits (recorded, not yet enforced).                                                                                                                                                                                                                                                                                           | SP-020                  |
| Catalogue & UoM   | SKUs with nested UoM ladders (e.g. EA → CS 12 → PL 480), exact conversion, largest-first breakdown, lot and expiry tracking, automatic daily lots for untracked SKUs.                                                                                                                                                                                                                                                                                                                       | SP-030, SP-031          |
| Inventory ledger  | Receipts (in any pack unit), bin-to-bin moves, reason-coded adjustments; append-only `inventory_movements` enforced by trigger; `stock_balances` projection updated in the same transaction; on-hand and movement queries; full-replay projection verification.                                                                                                                                                                                                                             | SP-040, SP-041          |
| Allocation        | Pure FEFO/FIFO/LIFO planner with expiry, shelf-life, hold and zone eligibility, best-fit pick minimisation, partial vs ship-complete; concurrency-safe API with one ordered `SELECT … FOR UPDATE`; release via compensating `DEALLOCATE` movements.                                                                                                                                                                                                                                         | SP-050, SP-051, SP-055  |
| Web               | Login, navigation with _Planned_ badges linking to ticketed placeholders, stock-on-hand by bin with receive/move forms, allocation form, list, detail and release.                                                                                                                                                                                                                                                                                                                          | SP-060, SP-061          |
| Pending surface   | 60 target endpoints registered behind authentication that answer `501 NOT_IMPLEMENTED` with `details.ticket`.                                                                                                                                                                                                                                                                                                                                                                               | (see pending catalogue) |

### 5.2 Planned (M2–M8)

Email verification, invitations, password reset, custom roles and 3PL client accounts; topology import, capacity enforcement and map; SKU attributes, import and ladder versioning, serial numbers; inventory holds, point-in-time queries, snapshots and adjustment approval; ASNs, receiving with discrepancies and QA; directed putaway and ABC slotting; order intake, order lifecycle, waves; pick path optimisation, pick execution, batch/cluster picking and a picker UI; carton catalogue, 3D cartonization and pack station; shipments, manifests, rates, documents and ship confirmation; cycle counting; replenishment; returns; Code128 labels and LPNs; reports, notifications, dashboards and 3PL billing; operational hardening (metrics, load tests, backups, ASVS L2, accessibility, end-to-end suite, ledger partitioning, offline scanner PWA, labour tracking, dock appointments).

## 6. Success metrics

Metrics marked **(slice)** can be measured on the current build; the rest become measurable as their milestone lands.

| #     | Metric                                                                | Target                                                                                                                                                     | Measured by                                                                                                                   |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| SM-1  | Oversold allocations (allocated > on-hand in any bin/lot)             | **0**, ever                                                                                                                                                | `stock_balances_allocated_le_on_hand` CHECK; concurrency test (12 racing orders for 39 units → exactly 7 succeed) **(slice)** |
| SM-2  | Projection drift found by `/inventory/projection/verify`              | **0 mismatches** in production; verified nightly                                                                                                           | Verify endpoint **(slice)**                                                                                                   |
| SM-3  | Expired lots allocated                                                | **0**                                                                                                                                                      | Allocation eligibility tests **(slice)**                                                                                      |
| SM-4  | Allocation API latency for a 20-line order over 10,000 candidate rows | **p95 < 250 ms**, p99 < 500 ms                                                                                                                             | Load test (SP-181)                                                                                                            |
| SM-5  | Receipt posting latency                                               | **p95 < 150 ms** per line                                                                                                                                  | Load test (SP-181)                                                                                                            |
| SM-6  | Bin-level inventory accuracy (cycle count lines with zero variance)   | **≥ 99.5%**                                                                                                                                                | Cycle counting (SP-131/SP-132)                                                                                                |
| SM-7  | Dock-to-stock time (ASN receipt → putaway confirmed)                  | **< 4 h** for 95% of lines                                                                                                                                 | Receiving + putaway timestamps (SP-071, SP-081)                                                                               |
| SM-8  | Pick travel distance versus SKU-sorted list                           | **−35%** median; −15% versus the serpentine sequence alone                                                                                                 | Pick path optimiser benchmark (SP-100)                                                                                        |
| SM-9  | Carton volume utilisation                                             | **≥ 75%** average fill                                                                                                                                     | Cartonization output (SP-111)                                                                                                 |
| SM-10 | Orders shipped by carrier cut-off                                     | **≥ 99%**                                                                                                                                                  | Wave + ship confirmation timestamps (SP-092, SP-123)                                                                          |
| SM-11 | Expiry write-offs (units adjusted out with reason `EXPIRED`)          | **−30%** within two quarters of adoption                                                                                                                   | Ledger reason codes, expiry exposure report (SP-171)                                                                          |
| SM-12 | Time to bill a 3PL client for a month                                 | **< 10 min**, down from ~1 day                                                                                                                             | Billing run (SP-174)                                                                                                          |
| SM-13 | Automated test coverage                                               | shared ≥ 90% lines, API ≥ 80% lines (enforced thresholds)                                                                                                  | Vitest coverage gates in CI **(slice)**                                                                                       |
| SM-14 | Credential stuffing resistance                                        | ≤ 5 free failures per account then exponential backoff (also under concurrent bursts); ≤ 50 failures and ≤ 20 distinct emails per normalised IP per 15 min | Auth throttle tests **(slice)**                                                                                               |

## 7. Release plan

Milestones follow [../planning/backlog.md](../planning/backlog.md). Hours are engineering estimates including tests and documentation.

| Milestone | Theme                  | Key tickets                                                                                                  |     Hours | Status             | Exit criteria                                                                                                                                                                |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ | --------: | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**    | Foundation & identity  | SP-001…SP-006, SP-010…SP-014                                                                                 |        60 | done               | CI green on native PostgreSQL; register/login/logout with CSRF, throttles and RBAC; audit rows written.                                                                      |
| **M1**    | Inventory core slice   | SP-020, SP-030, SP-031, SP-040, SP-041, SP-050, SP-051, SP-055, SP-060…SP-062                                |       106 | done               | Receive in pack units, move, adjust, allocate FEFO/FIFO/LIFO without overselling, release; projection verifies clean; stock and allocation screens usable with seed data.    |
| **M2**    | Inbound & putaway      | SP-009, SP-015, SP-017, SP-021, SP-022, SP-024, SP-033…SP-035, SP-042, SP-070…SP-073, SP-080, SP-081, SP-173 |       274 | pending            | Truck received against an ASN with discrepancies reported, QA holds applied, putaway directed to a bin with capacity checked.                                                |
| **M3**    | Orders & waves         | SP-052…SP-054, SP-090…SP-093                                                                                 |       140 | pending            | Orders imported, allocated with backorder retry, grouped into waves by cut-off and released as pick tasks.                                                                   |
| **M4**    | Picking                | SP-100…SP-103                                                                                                |       116 | pending            | Optimised pick paths beat the serpentine baseline by ≥15%; short picks handled; picker UI usable on a phone.                                                                 |
| **M5**    | Pack & ship            | SP-110…SP-112, SP-120…SP-123                                                                                 |       148 | pending            | Cartons recommended by the 3D heuristic, scan-verified packing, manifest and ship confirmation decrement inventory.                                                          |
| **M6**    | Inventory control      | SP-043…SP-045, SP-082, SP-130…SP-132, SP-140…SP-142, SP-171, SP-172                                          |       220 | pending            | Cycle counts with variance approval, min/max replenishment, point-in-time stock, aging/expiry reports.                                                                       |
| **M7**    | 3PL & returns          | SP-016, SP-018, SP-032, SP-150, SP-151, SP-160…SP-162, SP-174                                                |       204 | pending            | Client-scoped inventory, serials, RMAs, Code128 labels, LPNs, monthly storage/handling billing.                                                                              |
| **M8**    | Operations & hardening | SP-019, SP-023, SP-170, SP-180…SP-190                                                                        |       292 | pending            | Metrics and dashboards, load targets met, backup drill, ASVS L2 review, shared throttle store for multiple API instances, WCAG 2.1 AA, end-to-end suite, partitioned ledger. |
|           | **Total**              |                                                                                                              | **1,560** | 166 h done (10.6%) |                                                                                                                                                                              |

## 8. Assumptions and constraints

- One API instance behind a reverse proxy until SP-183/SP-190 move throttle state to a shared PostgreSQL store.
- PostgreSQL is installed natively; there is no container runtime in development, CI or production.
- Each organisation is one tenant; users belong to exactly one organisation and email is globally unique.
- Quantities are whole base units ≤ 10^12; fractional units (e.g. kilograms of loose product) are modelled as a smaller base unit (grams).
- Expiry is a calendar date; "today" is computed in the warehouse's IANA time zone.

## 9. Risks (summary)

| Risk                                               | Mitigation                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Ledger growth slows replay verification            | Snapshots (SP-044), monthly partitioning (SP-186)                        |
| Lock contention on hot SKUs during waves           | Short transactions, single ordered lock statement, load testing (SP-181) |
| 3D cartonization quality versus speed              | Heuristic with bounded search, benchmark on real order profiles (SP-111) |
| In-memory throttles in a multi-instance deployment | Documented single-instance constraint; SP-183, SP-190                    |

## 10. Open questions

1. Should ship-complete be settable per client (SP-052) as well as per order?
2. Should minimum shelf life be a per-client or per-SKU default rather than a request field?
3. Do clients need to see allocations, or only on-hand and available?
