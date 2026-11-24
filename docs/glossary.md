# StockPilot — Glossary

Warehouse, inventory and system terms as StockPilot uses them. Where a term maps to code, the identifier is given in `code`. Terms used in [product/requirements.md](product/requirements.md) and the backlog are defined here first.

## Organisations and parties

| Term                            | Definition                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3PL (third-party logistics)** | A company that stores and ships goods on behalf of other companies (its _clients_). One 3PL warehouse holds stock for many clients, which is why client-scoped inventory (SP-018) and storage/handling billing (SP-174) matter. |
| **Client**                      | A 3PL's customer that owns the stock. Planned as `client_id` on SKUs, lots, movements and orders (SP-018). Not to be confused with an API client.                                                                               |
| **Organisation**                | The tenant in StockPilot (`organizations` table). All data is scoped by `organization_id`; a 3PL is one organisation with many clients.                                                                                         |
| **Supplier / vendor**           | The party shipping goods _into_ the warehouse; named on ASNs.                                                                                                                                                                   |
| **Carrier**                     | The transport company collecting outbound shipments (parcel, LTL, FTL). Waves are planned by carrier cut-off.                                                                                                                   |

## Warehouse topology

| Term                                      | Definition                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Warehouse / site**                      | A physical building (`warehouses`). Has a code, a name and an IANA time zone that defines "today" for expiry.                                                                          |
| **Zone**                                  | An area of a warehouse with one purpose: `RECEIVING`, `STORAGE`, `PICK`, `STAGING`, `SHIPPING` or `QUARANTINE`. Only `STORAGE` and `PICK` stock is allocatable.                        |
| **Aisle / rack (bay) / level / position** | The segments of a structured bin code `ZONE-AA-RR-L-P`, e.g. `A-03-12-2-B` = zone A, aisle 03, rack 12, level 2 (0 = floor), position B.                                               |
| **Bin / location**                        | The smallest addressable storage place (`bins`). Stock balances are kept per bin. Free-form codes (`RCV01`, `DOCK1`, `QCAGE1`) are used for docks, staging and cages.                  |
| **Pick face (forward pick location)**     | A bin in a `PICK` zone, at a convenient height near the start of the pick path, from which eaches and cases are picked. Replenished from reserve.                                      |
| **Reserve (bulk storage)**                | Overflow storage, typically full pallets in `STORAGE` zones, used to replenish pick faces and to pick full cases or pallets.                                                           |
| **Staging**                               | A temporary area where picked or received goods wait before the next step (packing, loading, putaway).                                                                                 |
| **Dock / dock door**                      | Where trucks load and unload; receiving and shipping start and end here.                                                                                                               |
| **Quarantine**                            | A zone for stock that must not be used until released (failed QA, damaged, recalled). Never allocatable.                                                                               |
| **Pick sequence**                         | An integer per bin (`pick_sequence`) giving its order along the walking route. Defaults to a serpentine value derived from the bin code; replaced by distance-based routing in SP-100. |
| **Serpentine (S-shape) route**            | A walk that goes up odd aisles and down even aisles, entering every aisle that contains a pick. StockPilot's default pick sequence encodes it.                                         |
| **Bin capacity**                          | Maximum weight (g) and volume (cm³) a bin may hold (`max_weight_g`, `max_volume_cm3`). Recorded today; enforced from SP-022.                                                           |
| **Warehouse map**                         | Planned SVG rendering of zones, aisles and bins (SP-023).                                                                                                                              |

## Products and units of measure

| Term                         | Definition                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SKU (stock-keeping unit)** | One distinct product the warehouse tracks (`skus`). Has a code, a UoM ladder, tracking flags and a default allocation strategy.                                                                                               |
| **UoM (unit of measure)**    | A unit in which a SKU is counted: EA (each), IP (inner pack), CS (case), PL (pallet), etc. Codes match `^[A-Z][A-Z0-9]{0,9}$`.                                                                                                |
| **Base unit**                | The smallest unit of a SKU, with factor 1 (often EA). **Every stored quantity is a whole number of base units.**                                                                                                              |
| **UoM ladder**               | A SKU's base unit plus its pack levels, each defined as a whole number of base units, e.g. EA → CS = 12 → PL = 480. Ladders must be _nested_: each level is a whole multiple of the level below (a pallet holds whole cases). |
| **Pack level / factor**      | One rung of the ladder and its size in base units (`factor ≥ 2`).                                                                                                                                                             |
| **Conversion**               | Turning a quantity in one unit into another. Exact or rejected (`NON_INTEGRAL_CONVERSION`); never rounded.                                                                                                                    |
| **Breakdown**                | Expressing a base quantity in the largest units first: 1000 EA → `2 PL + 3 CS + 4 EA`. Greedy decomposition is exact because ladders are nested.                                                                              |
| **Item attributes**          | Dimensions, weight, hazmat and temperature class per SKU or pack level (SP-034); needed for capacity, putaway and cartonization.                                                                                              |
| **GTIN**                     | Global Trade Item Number printed as a barcode on product packaging; planned as a scan alias for SKUs in receiving and picking flows.                                                                                          |

## Lots, expiry and serials

| Term                          | Definition                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lot (batch)**               | A group of units of one SKU produced or received together and sharing an expiry (`lots`). Unique per (SKU, lot code).                                                                                  |
| **Lot-tracked SKU**           | A SKU whose receipts must name a lot (`lot_tracked`).                                                                                                                                                  |
| **Expiry-tracked SKU**        | A SKU whose lots carry an expiry date (`expiry_tracked`). Requires lot tracking.                                                                                                                       |
| **Auto lot**                  | The system lot `AUTO-YYYYMMDD` created for untracked SKUs on each receipt day (warehouse time zone) so FIFO/LIFO still have an age.                                                                    |
| **Expiry date / best-before** | A calendar date (no time) after which a lot must not ship. A lot with expiry ≤ today is _expired_.                                                                                                     |
| **Shelf life (remaining)**    | Days between today and a lot's expiry. **Minimum shelf life** (`minShelfLifeDays`) excludes lots with fewer remaining days than the customer accepts; a lot expiring exactly on today + N is accepted. |
| **Hold**                      | A flag (`on_hold`) or, from SP-042, a status (`QUARANTINE`, `DAMAGED`, `QA`) that keeps stock on hand but unallocatable.                                                                               |
| **Serial number**             | A unique identifier for a single unit (SP-032).                                                                                                                                                        |
| **Recall**                    | Tracing and blocking every unit of a lot; relies on lot-level ledger history.                                                                                                                          |

## Inventory quantities

| Term                     | Definition                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **On-hand**              | Units physically in a bin for a SKU/lot (`stock_balances.on_hand`). Never negative.                                           |
| **Allocated (reserved)** | Units on hand that are promised to orders (`stock_balances.allocated`). Never greater than on-hand.                           |
| **Available**            | `on_hand − allocated`: what can still be allocated, moved or adjusted out. Never negative.                                    |
| **Oversell**             | Promising more units than are available. StockPilot prevents it with ordered row locks, domain checks and a CHECK constraint. |
| **Shrinkage**            | Loss of stock through damage, theft or error; surfaces as `ADJUST_OUT` movements with reasons `DAMAGED`, `LOST`, `EXPIRED`.   |
| **Inventory accuracy**   | Share of counted bin/SKU/lot lines whose count equals the system quantity.                                                    |
| **Aging**                | Time since a lot was received; reported in buckets (SP-171).                                                                  |
| **Expiry exposure**      | Units that will expire within a horizon (30/60/90 days).                                                                      |

## Ledger and projection

| Term                         | Definition                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ledger (movement ledger)** | The append-only table `inventory_movements`; the source of truth for inventory. A trigger rejects every `UPDATE` and `DELETE`.                                                                          |
| **Movement**                 | One ledger row: type, SKU, lot, from-bin and/or to-bin, positive quantity, reason, reference, actor, correlation ID, timestamp.                                                                         |
| **Movement types**           | `RECEIPT` (into a bin), `MOVE` (bin to bin), `ADJUST_IN` / `ADJUST_OUT` (count corrections), `ALLOCATE` / `DEALLOCATE` (reserve / release on a bin). Picks and shipments add types in later milestones. |
| **Effect**                   | What a movement does to one balance: `ON_HAND_IN`, `ON_HAND_OUT`, `ALLOCATE`, `DEALLOCATE`. A `MOVE` has two effects.                                                                                   |
| **Event sourcing**           | Storing every change as an immutable event and deriving current state by folding the events.                                                                                                            |
| **Projection**               | State derived from the ledger. `stock_balances` is the on-hand projection, updated in the same transaction as each append.                                                                              |
| **Replay / fold**            | Recomputing the projection from the first movement (`projectBalances`).                                                                                                                                 |
| **Projection verification**  | Replaying the ledger and comparing it with stored balances (`GET /inventory/projection/verify`); any difference is _drift_.                                                                             |
| **Compensating movement**    | A new movement that reverses or corrects an earlier one (e.g. `DEALLOCATE` after `ALLOCATE`), used because the ledger cannot be edited.                                                                 |
| **Correlation ID**           | A UUID shared by all movements produced by one command, e.g. all `ALLOCATE` rows of one order.                                                                                                          |
| **Snapshot**                 | A stored copy of balances at a movement ID, so replays can start from it (SP-044).                                                                                                                      |
| **Point-in-time query**      | Balances as of a past instant, from snapshot plus replay (SP-043).                                                                                                                                      |
| **Adjustment reason**        | Why stock was corrected: `DAMAGED`, `FOUND`, `LOST`, `EXPIRED`, `CORRECTION`.                                                                                                                           |

## Allocation

| Term                                 | Definition                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Allocation**                       | Reserving specific bin/lot quantities for an order (`allocations`, `allocation_lines`, `allocation_picks`) and posting `ALLOCATE` movements.                    |
| **Allocation strategy**              | The rule deciding which lots go first: FEFO, FIFO or LIFO. Set per SKU (`default_strategy`) and overridable per request.                                        |
| **FEFO (first expired, first out)**  | Consume the earliest expiry first; lots without expiry last. Standard for food, pharma and cosmetics.                                                           |
| **FIFO (first in, first out)**       | Consume the oldest receipt first, regardless of expiry.                                                                                                         |
| **LIFO (last in, first out)**        | Consume the newest receipt first; used for some non-perishables or when older stock is held back.                                                               |
| **Candidate**                        | A bin/lot balance row with available stock in an allocatable zone, locked for the duration of an allocation.                                                    |
| **Exclusion reason**                 | Why a candidate was skipped: `EXPIRED`, `SHORT_SHELF_LIFE`, `ON_HOLD`, `NO_AVAILABLE`.                                                                          |
| **Best fit**                         | Within equally ranked lots, choosing the smallest single bin that covers the remainder, to keep larger quantities intact and minimise pick touches.             |
| **Ship-complete (fill-or-kill)**     | All lines of the order must be fully allocated or nothing is reserved.                                                                                          |
| **Partial allocation**               | Lines may be partly filled; the shortfall is reported. Status `PARTIAL`.                                                                                        |
| **Shortfall**                        | Requested minus allocated quantity for a line.                                                                                                                  |
| **Backorder**                        | An unallocated quantity kept open for retry when stock arrives (SP-054).                                                                                        |
| **Release**                          | Returning an allocation's units to available with `DEALLOCATE` movements; status `RELEASED`.                                                                    |
| **Row lock (`SELECT … FOR UPDATE`)** | PostgreSQL lock taken on candidate rows so concurrent allocators cannot read the same availability. Always acquired in `(sku_id, id)` order to avoid deadlocks. |
| **Deadlock**                         | Two transactions each waiting for a lock the other holds; prevented by consistent lock ordering.                                                                |

## Inbound

| Term                              | Definition                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **ASN (advance shipping notice)** | A supplier's message describing an inbound delivery: SKUs, quantities, units, lots, expected arrival (SP-070).      |
| **Receiving / receipt**           | Recording goods arriving into a receiving bin; posts `RECEIPT` movements.                                           |
| **Discrepancy**                   | A difference between an ASN and what was received: short, over, unexpected SKU, wrong lot/expiry, damaged (SP-071). |
| **Over-receipt tolerance**        | The percentage above the ASN quantity that may be accepted without escalation.                                      |
| **QA inspection**                 | Checking received goods before they become usable; failures stay in quarantine (SP-073).                            |
| **Dock-to-stock time**            | Time from receipt at the dock to putaway confirmation.                                                              |
| **Dock appointment**              | A booked time slot at a dock door for a carrier (SP-189).                                                           |

## Putaway and slotting

| Term                   | Definition                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Putaway**            | Moving received goods from receiving to a storage or pick bin.                                                       |
| **Directed putaway**   | The system chooses the destination bin using rules: zone compatibility, capacity, consolidation, proximity (SP-080). |
| **Slotting**           | Deciding which SKU lives in which pick face.                                                                         |
| **ABC classification** | Ranking SKUs by velocity or value: A (top ~20% of SKUs, ~80% of picks), B, C. Drives slotting and count frequency.   |
| **Velocity**           | Rate at which a SKU is picked (units or pick lines per day).                                                         |

## Outbound, picking and packing

| Term                               | Definition                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Order / order line**             | A customer request to ship quantities of SKUs; each line is one SKU and quantity.                                                                                                       |
| **Order reference**                | The external order number (`order_ref`); one open allocation per reference per warehouse.                                                                                               |
| **Wave**                           | A group of orders released to the floor together, typically by carrier cut-off and zone (SP-092).                                                                                       |
| **Carrier cut-off**                | The latest time an order can be shipped to make a carrier's collection.                                                                                                                 |
| **Wave release**                   | Turning a wave's allocations into pick tasks (SP-093).                                                                                                                                  |
| **Pick task**                      | An instruction to take a quantity of a SKU/lot from a bin.                                                                                                                              |
| **Pick path**                      | The route a picker walks through the bins of a task list.                                                                                                                               |
| **Pick path optimisation**         | Ordering bins to minimise walking: S-shape, largest-gap and 2-opt heuristics over aisle geometry (SP-100).                                                                              |
| **Largest-gap heuristic**          | A routing method that enters each aisle from the nearer end and skips the largest empty gap between picks.                                                                              |
| **2-opt**                          | A local-search improvement that repeatedly reverses a segment of the route when that shortens it.                                                                                       |
| **Short pick**                     | Finding fewer units in a bin than the task requires (SP-101).                                                                                                                           |
| **Batch picking**                  | Picking several orders in one trip and sorting later.                                                                                                                                   |
| **Cluster picking**                | Picking several orders in one trip directly into separate totes (SP-102).                                                                                                               |
| **Tote**                           | A reusable container used by pickers.                                                                                                                                                   |
| **Cartonization**                  | Choosing the number and size of shipping cartons for an order and how items fit, using a 3D bin-packing heuristic (SP-111).                                                             |
| **3D bin packing**                 | Placing boxes (items) into containers (cartons) without overlap, allowing rotations, to minimise cartons and empty space; NP-hard, so solved heuristically (e.g. first-fit decreasing). |
| **Carton type**                    | A shipping box with inner dimensions, tare weight and maximum gross weight (SP-110).                                                                                                    |
| **Fill rate (carton utilisation)** | Item volume divided by carton volume.                                                                                                                                                   |
| **Dimensional (dim) weight**       | Billable weight computed from carton volume divided by a carrier's divisor; charged when larger than actual weight.                                                                     |
| **Pack station**                   | A bench where picked items are verified by scan and packed (SP-112).                                                                                                                    |

## Shipping

| Term                     | Definition                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| **Shipment**             | One or more cartons sent to one destination by one carrier (SP-120).             |
| **Manifest**             | A carrier's list of shipments collected at one time, signed by the driver.       |
| **Bill of lading (BOL)** | The legal shipping document between shipper and carrier for a load (SP-122).     |
| **Packing list**         | A document listing the contents of a shipment.                                   |
| **Ship confirmation**    | Recording that a shipment left; reduces on-hand and allocated together (SP-123). |
| **Rate table**           | Local carrier prices by service, zone and weight break (SP-121).                 |

## Inventory control

| Term                           | Definition                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Cycle count**                | Counting a subset of bins regularly instead of a full shutdown stocktake (SP-130).                                   |
| **Blind count**                | A count where the counter does not see the expected quantity (SP-131).                                               |
| **Variance**                   | Counted minus system quantity.                                                                                       |
| **Variance approval**          | Review of variances before they are posted as adjustments (SP-132).                                                  |
| **Adjustment approval**        | Second-person approval for adjustments above a threshold (SP-045).                                                   |
| **Replenishment**              | Moving stock from reserve to pick faces.                                                                             |
| **Min/max**                    | A replenishment rule: when a pick face falls to _min_, top it up toward _max_ in whole replenishment units (SP-140). |
| **Demand-based replenishment** | Topping up pick faces ahead of a wave based on its allocated demand (SP-142).                                        |

## Returns, labels and handling units

| Term                                       | Definition                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RMA (return merchandise authorisation)** | Permission for a customer to return specific shipped units (SP-150).                                                                                                 |
| **Disposition**                            | What happens to a returned unit: `RESTOCK`, `QUARANTINE` or `SCRAP` (SP-151).                                                                                        |
| **Code128**                                | A high-density linear barcode symbology covering all 128 ASCII characters, with code sets A/B/C and a modulo-103 check character. Rendered in-house as SVG (SP-160). |
| **Label template**                         | Layout for bin, LPN, carton or shipping labels (SP-161).                                                                                                             |
| **LPN (licence plate number)**             | A unique barcode on a pallet, case or tote that identifies its contents, so a whole handling unit moves with one scan (SP-162).                                      |
| **Handling unit**                          | A physical container tracked as a unit: pallet, case, tote. LPNs may nest (pallet → cases).                                                                          |

## Reporting and billing

| Term                     | Definition                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **Storage billing**      | Charging a 3PL client per pallet-day, bin-day or cubic-metre-day of stock held (SP-174). |
| **Handling billing**     | Charging per activity: receipt lines, picks, cartons shipped.                            |
| **Rate card**            | A client's agreed prices for storage and handling.                                       |
| **Throughput**           | Units or lines processed per hour by process (receive, pick, pack, ship).                |
| **Units per hour (UPH)** | Labour productivity metric (SP-188).                                                     |

## System and security terms

| Term                                  | Definition                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Envelope**                          | The standard API response shape `{ data, error, meta? }`.                                                                                                                                                                                                                                                                                                                                                  |
| **Pending endpoint**                  | A target API route that is registered but answers `501 NOT_IMPLEMENTED` with `details.ticket`.                                                                                                                                                                                                                                                                                                             |
| **RBAC (role-based access control)**  | Permissions granted through roles: `owner`, `admin`, `manager`, `operator`, `viewer`. Routes check permissions such as `inventory:receive`, never role names.                                                                                                                                                                                                                                              |
| **Session**                           | A server-side login record in PostgreSQL; the browser holds only a random token in the httpOnly `sp_session` cookie. The database stores `HMAC-SHA256(secret, token)`.                                                                                                                                                                                                                                     |
| **CSRF double-submit**                | Protection against cross-site request forgery: mutating requests must send the `X-CSRF-Token` header equal to the session's token, also given to the browser in the readable `sp_csrf` cookie.                                                                                                                                                                                                             |
| **Progressive backoff**               | A login delay per email that doubles with each failure beyond the free attempts (30 s, 60 s, 120 s … capped at 15 min).                                                                                                                                                                                                                                                                                    |
| **Attempt reservation**               | Counting a login attempt synchronously before any I/O so concurrent bursts cannot all pass the throttle; a successful login gives its reservation back.                                                                                                                                                                                                                                                    |
| **Password spraying**                 | Trying one or a few passwords against many accounts; countered by the per-IP limiter and the per-IP distinct-email cap.                                                                                                                                                                                                                                                                                    |
| **Count-min sketch (failure sketch)** | A fixed-size table of counters (4 rows × 16,384, about 1 MiB) keyed by HMAC so collisions cannot be aimed at a victim. The bounded per-email store is authoritative; the sketch only absorbs _active_ lock-outs that had to be force-evicted, and is read only for emails with no entry in the store. If a row is more than half full, it is ignored and `throttle_sketch_saturated` is logged (ADR-0020). |
| **Normalised IP**                     | The throttling key for a client: IPv4-mapped IPv6 collapsed to IPv4, IPv6 reduced to its /64 prefix. The distinct-email cap also applies per enclosing IPv6 /48 (4 × the /64 allowance).                                                                                                                                                                                                                   |
| **Account enumeration**               | Discovering which emails have accounts from differences in responses; prevented by identical registration (202) and login (401) responses.                                                                                                                                                                                                                                                                 |
| **`TRUST_PROXY`**                     | Configuration naming which reverse proxies may set `X-Forwarded-For`; `false`, a hop count, or a list of IPs/CIDRs, never `true`. Must be explicit in production.                                                                                                                                                                                                                                          |
| **Audit event**                       | A row in `audit_events` recording who did what, to which entity, with which request ID.                                                                                                                                                                                                                                                                                                                    |
| **Request ID**                        | An identifier per HTTP request, echoed in `x-request-id` and logged with every line for that request.                                                                                                                                                                                                                                                                                                      |
| **Migration**                         | A forward-only SQL file applied once and protected by a checksum.                                                                                                                                                                                                                                                                                                                                          |
| **Projection drift**                  | A difference between stored balances and a ledger replay; should always be zero.                                                                                                                                                                                                                                                                                                                           |
| **MoSCoW**                            | Requirement priority: Must, Should, Could, Won't (this time).                                                                                                                                                                                                                                                                                                                                              |
