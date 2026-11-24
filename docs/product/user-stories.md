# StockPilot — User Stories

Stories are grouped by the epics in [../planning/backlog.md](../planning/backlog.md). Each story names its persona (see [PRD.md §3](PRD.md#3-personas)), the functional requirement(s) it realises ([requirements.md](requirements.md)), the delivering ticket, and its status: **done** (behaviour exists and is tested) or **pending**.

Story IDs are `US-<epic>.<n>`.

---

## E01 — Platform foundation

### US-01.1 Fail fast on bad configuration — done

_As Omar (administrator), I want the API to refuse to start with invalid settings so that a typo never becomes an insecure production system._ · FR-001 · SP-002

- **Given** `SESSION_SECRET` is 20 characters long, **when** the API starts, **then** it exits with `Invalid configuration: SESSION_SECRET: SESSION_SECRET must be at least 32 characters`.
- **Given** `NODE_ENV=production` and a secret containing `replace-me`, **when** the API starts, **then** it refuses to run.
- **Given** no `API_PORT`, **when** the API starts, **then** it listens on 4103.

### US-01.2 Diagnose any failed request — done

_As Omar, I want every response to carry a request ID and a consistent error shape so that support can find the exact log line._ · FR-002 · SP-003

- **Given** a request with `X-Request-Id: trace-12345678`, **when** it completes, **then** the response header `x-request-id` is `trace-12345678`.
- **Given** a malformed request ID `bad id!`, **when** it completes, **then** a fresh UUID is returned instead.
- **Given** a call to `/api/v1/nope`, **when** it is processed, **then** the response is `404` with `error.code = "ROUTE_NOT_FOUND"` and `data: null`.

### US-01.3 Gate deployments on readiness — done

_As Omar, I want a readiness probe that checks the database and migrations so that the proxy only routes to a healthy instance._ · FR-003, FR-004 · SP-003, SP-004

- **Given** a migrated database, **when** `GET /api/v1/ready` is called, **then** it returns `200` with `database: "up"` and the number of applied migrations.
- **Given** the database is down, **when** `/ready` is called, **then** it returns `503 NOT_READY`.
- **Given** an applied migration file was edited, **when** migrations run, **then** they abort and ask for a new migration instead.

### US-01.4 See what is coming — done

_As Wendy (warehouse manager), I want planned features to be visible with their ticket so that I know what is coming and nothing pretends to work._ · FR-005, FR-007 · SP-003, SP-060

- **Given** I am signed in, **when** I call `GET /api/v1/waves`, **then** I get `501` with `error.code = "NOT_IMPLEMENTED"` and `details.ticket = "SP-092"`.
- **Given** I am not signed in, **when** I call a pending endpoint, **then** I get `401`.
- **Given** I open _Picking_ in the navigation, **when** the page renders, **then** it shows a _Planned_ badge and ticket SP-100.

### US-01.5 Start from a fresh checkout — done

_As a developer evaluating StockPilot, I want one command to set up and run everything so that I can try the slice in minutes._ · FR-006 · SP-006, SP-062

- **Given** Node.js 22 and a running local PostgreSQL, **when** I run `./run.sh`, **then** `.env` is written with a random secret, the database is created, migrated and seeded, and API and web start.
- **Given** the seed has run, **when** I sign in as `operator@stockpilot.test`, **then** I see stock on hand by bin in the demo warehouse.

---

## E02 — Identity & access

### US-02.1 Register my organisation — done

_As Omar, I want to create a workspace and owner account so that my team can start using StockPilot._ · FR-008, FR-015 · SP-010, SP-012

- **Given** a new email, **when** I register with a 12+ character password, **then** I get `202` with "If this email can be registered, the workspace is ready. Sign in to continue." and no session cookie.
- **Given** an email that is already registered, **when** anyone registers with it, **then** the response is byte-for-byte the same `202` and an `auth.register_duplicate` audit row is written.
- **Given** 10 registration attempts from my IP in the last hour, **when** I try again, **then** I get `429 RATE_LIMITED` with `Retry-After`.

### US-02.2 Sign in and out securely — done

_As Ravi (receiving clerk), I want to sign in with email and password and sign out on a shared terminal so that my actions are attributed to me._ · FR-009, FR-010, FR-011 · SP-010, SP-011

- **Given** valid credentials, **when** I sign in, **then** I receive an httpOnly `sp_session` cookie and an `sp_csrf` cookie, and `/auth/me` returns my user, role and organisation.
- **Given** a wrong password or unknown email, **when** I sign in, **then** I see "Email or password is incorrect" in both cases.
- **Given** I sign out, **when** someone replays my old session cookie, **then** they get `401`.

### US-02.3 Stop forged requests — done

_As Omar, I want state-changing requests to require a CSRF token so that a malicious site cannot post stock movements in a signed-in user's browser._ · FR-012 · SP-011

- **Given** a signed-in session, **when** a `POST /inventory/moves` arrives without `X-CSRF-Token`, **then** it is rejected with `403 CSRF_INVALID` and nothing is written.
- **Given** the correct header, **when** the same request is sent, **then** it is processed.
- **Given** a `GET` request, **when** it has no CSRF header, **then** it is processed normally.

### US-02.4 Resist password guessing — done

_As Omar, I want login attempts throttled per account and per source address so that credential stuffing and spraying fail._ · FR-013, FR-014, FR-016, NFR-027 · SP-012

- **Given** 20 concurrent bad logins for `ravi@example.com`, **when** they arrive together, **then** at most 5 reach password verification and the rest get `429`.
- **Given** 5 failed logins for `ravi@example.com` from 5 different IPs, **when** a 6th attempt arrives from a new IP, **then** it is refused with `429` and `retryAfterSeconds = 30`; the next failure after the wait doubles the delay to 60 s, capped at 15 minutes.
- **Given** one IP has failed 50 logins across 50 different emails in 15 minutes, **when** it tries any email, **then** it gets `429` until the 15-minute window ends; a successful login from that IP frees only its own slot and does not reset the window.
- **Given** `ravi@example.com` is locked out and an attacker floods the throttle with 100,000+ new emails, **when** Ravi's attacker tries again, **then** the lock-out still applies (the evicted active entry was absorbed into the count-min sketch), while emails that were never tried are not locked out and a later successful login by Ravi clears the lock-out.
- **Given** one IPv6 /48 has tried 80 distinct emails across rotating /64s, **when** any /64 in it tries another new email, **then** it gets `429`.
- **Given** one IPv6 /64 has already tried 20 distinct emails in the window, **when** any address in that /64 tries a 21st email, **then** it gets `429`.
- **Given** the throttle stores are full of an attacker's keys, **when** a legitimate user logs in for the first time, **then** the attempt is accepted (the oldest-expiring entry is evicted with a warning).
- **Given** `TRUST_PROXY=false`, **when** an attacker rotates `X-Forwarded-For`, **then** the per-IP limit still applies to the real socket address.
- **Given** `TRUST_PROXY=true` in the environment, **when** the API starts, **then** it refuses the configuration.
- **Given** `NODE_ENV=production` and no `TRUST_PROXY`, **when** the API starts, **then** it refuses to run until the value is set explicitly.

### US-02.5 Least-privilege roles — done

_As Omar, I want each user's role to limit what they can do so that a picker cannot adjust stock or change topology._ · FR-017 · SP-013

- **Given** I am an `operator`, **when** I post an adjustment, **then** I get `403 FORBIDDEN`; receipts and moves succeed.
- **Given** I am a `viewer`, **when** I post a receipt, **then** I get `403`; reads succeed.
- **Given** I am a `manager`, **when** I call projection verify, **then** I get `403`; as `admin` I get the report.

### US-02.6 Every change is attributable — done

_As Ivan (inventory controller), I want an audit row for every sign-in and stock change so that I can investigate discrepancies._ · FR-018 · SP-014

- **Given** I post a receipt, **when** the transaction commits, **then** an `inventory.received` audit row exists with my user ID, the request ID and the SKU, bin, lot and base quantity.
- **Given** a failed login, **when** it is processed, **then** `auth.login_failed` is recorded without an actor.

### US-02.7 Keep tenants apart — done

_As Amara (3PL account manager), I want assurance that no other organisation can see our warehouses so that client data stays confidential._ · FR-019 · SP-013, SP-020

- **Given** a warehouse belongs to organisation A, **when** a user of organisation B requests it by ID, **then** they get `404`, and `GET /warehouses` returns an empty list for them.

### US-02.8 Verify email at signup — pending

_As Omar, I want new accounts to confirm their email so that workspaces are not created with addresses the owner does not control._ · FR-020 · SP-009

- **Given** I register, **when** I try to log in before verifying, **then** I am told to verify first; **given** I follow the outbox link within 24 h, **then** login succeeds.

### US-02.9 Invite my team — pending

_As Omar, I want to invite users with a role so that staff do not share logins._ · FR-021 · SP-015

- **Given** I invite `paula@example.com` as `operator`, **when** she accepts within 7 days, **then** she can sign in with operator permissions; **given** I deactivate her, **then** her sessions stop working immediately.

### US-02.10 Reset a forgotten password — pending

_As Paula (picker), I want to reset my password myself so that I am not locked out at shift start._ · FR-022 · SP-017

- **Given** I request a reset, **when** I use the link within 30 minutes, **then** my password changes and all my other sessions end.

### US-02.11 Tailor roles — pending

_As Omar, I want custom roles so that a "receiving lead" can adjust stock but not change topology._ · FR-023 · SP-016

- **Given** I create a role with `inventory:adjust` but not `topology:write`, **when** a user with that role creates a bin, **then** they get `403`.

### US-02.12 Client-scoped access — pending

_As Amara, I want each 3PL client's users to see only their own inventory so that I can give clients self-service access._ · FR-024 · SP-018

- **Given** clients Acme and Birch share a warehouse, **when** an Acme user queries balances, **then** only Acme SKUs appear, and Acme orders never allocate Birch stock.

### US-02.13 Browse the audit log — pending

_As Ivan, I want to filter and export audit events so that I can answer auditors' questions._ · FR-025 · SP-019

- **Given** I filter by action `inventory.adjusted` for last month, **when** I export, **then** I get a CSV of exactly those events.

---

## E03 — Warehouse topology

### US-03.1 Create a warehouse in its local time zone — done

_As Omar, I want each warehouse to have its own time zone so that "today" for expiry is the local date at the site._ · FR-026 · SP-020

- **Given** I create a warehouse with time zone `europe/london`, **when** it is saved, **then** it is stored as `Europe/London`.
- **Given** time zone `Mars/Olympus`, **when** I submit, **then** I get `400` "Unknown IANA time zone".
- **Given** a lot expiring today in `Pacific/Auckland` while it is still yesterday in UTC, **when** I allocate in the Auckland warehouse, **then** the lot is treated as expired.

### US-03.2 Model zones by purpose — done

_As Omar, I want typed zones so that receiving and quarantine stock is never promised to customers._ · FR-027, FR-060 · SP-020, SP-051

- **Given** stock sits in a `RECEIVING` or `QUARANTINE` zone, **when** an order is allocated, **then** that stock is not used even if it has the best expiry.

### US-03.3 Enforce our location naming scheme — done

_As Omar, I want bin codes validated so that labels and pick paths can rely on them._ · FR-028 · SP-020

- **Given** I create bin `a-03-12-2-b`, **when** it is saved, **then** its code is `A-03-12-2-B`.
- **Given** bin `A-00-12-2-B`, **when** I submit, **then** I get `400 INVALID_BIN_CODE` (aisles start at 01).
- **Given** bin `RCV01`, **when** I submit, **then** it is accepted as a free-form dock location.

### US-03.4 Walk the aisles in a sensible order — done

_As Paula, I want bins sequenced in a serpentine walk so that pick lists do not send me back and forth._ · FR-029 · SP-020

- **Given** bins `A-01-02-1-A` and `A-02-02-1-A`, **when** no pick sequence is given, **then** aisle 1 sorts racks ascending and aisle 2 descending.
- **Given** I supply `pickSequence: 5`, **when** the bin is saved, **then** 5 is used.

### US-03.5 Record bin limits — done

_As Omar, I want to record each bin's weight and volume limit so that putaway can respect them later._ · FR-030 · SP-020

- **Given** I create a bin with `maxWeightGrams: 500000`, **when** I read it back, **then** the limit is returned.

### US-03.6 Import a site layout — pending

_As Omar, I want to import thousands of bins from CSV so that onboarding a site takes minutes, not days._ · FR-031 · SP-021

- **Given** a CSV with one invalid bin code on line 812, **when** I import, **then** nothing is written and line 812 is reported.

### US-03.7 Stop overfilled bins — pending

_As Ravi, I want the system to stop me putting more into a bin than it can hold so that racking stays safe._ · FR-032 · SP-022

- **Given** a bin with 50 kg remaining, **when** I move 60 kg into it, **then** I get `409 BIN_CAPACITY_EXCEEDED` naming weight.

### US-03.8 Retire a location — pending

_As Omar, I want to deactivate bins so that damaged racking is not used._ · FR-033 · SP-024

- **Given** a bin still holds stock, **when** I deactivate it, **then** I am refused; **given** it is empty, **then** it is deactivated and excluded from receipts, moves and allocation.

### US-03.9 See the building — pending

_As Wendy, I want a map of the warehouse shaded by fill and expiry so that I can spot problems at a glance._ · FR-034 · SP-023

- **Given** structured bin codes, **when** I open the map, **then** aisles and racks are laid out and bins with expired stock are highlighted.

---

## E04 — Catalogue & UoM

### US-04.1 Define how a product is packed — done

_As Omar, I want each SKU to have a unit ladder (each, case, pallet) so that receiving and picking can use real pack sizes._ · FR-035, FR-036 · SP-030

- **Given** base `EA`, `CS` = 12 and `PL` = 480, **when** I create the SKU, **then** it is saved with levels sorted by factor.
- **Given** `CS` = 12 and `PL` = 100, **when** I submit, **then** I get `400 INVALID_UOM_LADDER` because 100 is not a whole number of cases.
- **Given** `expiryTracked: true` with `lotTracked: false`, **when** I submit, **then** I get `400` "Expiry tracking requires lot tracking".

### US-04.2 Never round a quantity — done

_As Ravi, I want unit conversions to be exact so that a case count never silently becomes a wrong each count._ · FR-037 · SP-030

- **Given** a case holds 12, **when** 18 EA is converted to CS, **then** the conversion fails with `NON_INTEGRAL_CONVERSION`.
- **Given** a fractional or zero quantity, **when** I post a receipt, **then** I get `400`.

### US-04.3 Read quantities the way the floor counts — done

_As Paula, I want large quantities shown as pallets, cases and eaches so that I know what to pick up._ · FR-038 · SP-030, SP-061

- **Given** 1000 EA of a SKU with CS 12 / PL 480, **when** I view stock, **then** it reads `2 PL + 3 CS + 4 EA`.

### US-04.4 Track lots and expiry — done

_As Ivan, I want lots with expiry dates recorded so that FEFO and recalls work._ · FR-039 · SP-031

- **Given** receipts into lots `L2` (expires 2027-03-01) and `L1` (expires 2027-01-15), **when** I list the SKU's lots, **then** `L1` comes first.

### US-04.5 Record dimensions and handling classes — pending

_As Omar, I want item dimensions, weight, hazmat and temperature class so that putaway and cartonization are accurate._ · FR-040 · SP-034

- **Given** a case is 400×300×250 mm and 9 kg, **when** cartonization runs, **then** those values are used.

### US-04.6 Bulk-load the catalogue — pending

_As Amara, I want to import a client's SKU list so that onboarding is quick._ · FR-041 · SP-033

- **Given** a CSV of 5,000 SKUs with ladders, **when** I import and re-export, **then** the files are identical.

### US-04.7 Change a pack size safely — pending

_As Omar, I want ladder changes versioned so that history stays correct when a supplier changes case size._ · FR-042 · SP-035

- **Given** open allocations reference `CS` = 12, **when** I change it to 10, **then** the change is refused until they are closed.

### US-04.8 Track serial numbers — pending

_As Ivan, I want serial numbers for high-value items so that each unit can be traced._ · FR-043 · SP-032

- **Given** a serial-tracked SKU, **when** I receive 3 units, **then** I must scan 3 distinct serials.

---

## E05 — Inventory ledger

### US-05.1 Receive in the unit on the carton — done

_As Ravi, I want to receive "2 cases" and have the system store 24 eaches so that I never multiply in my head._ · FR-044 · SP-040

- **Given** a SKU with `CS` = 12, **when** I receive 2 CS into bin `RCV01`, **then** a `RECEIPT` movement of 24 EA is appended, the response shows `quantityDescription: "2 CS"`, and the bin's on-hand rises by 24.

### US-05.2 Capture lot and expiry correctly — done

_As Ravi, I want the system to ask for lot and expiry only when the SKU needs them and catch mismatches so that bad data never enters stock._ · FR-045 · SP-031, SP-040

- **Given** a lot-tracked SKU, **when** I omit `lotCode`, **then** I get `400` naming `lotCode`.
- **Given** a non-tracked SKU, **when** I send `expiryDate`, **then** I get `400` naming `expiryDate`.
- **Given** lot `L1` already exists with expiry 2027-01-15, **when** I receive `L1` with expiry 2027-02-01, **then** I get `409 LOT_EXPIRY_MISMATCH` showing both dates.
- **Given** a non-tracked SKU, **when** I receive it, **then** it goes into lot `AUTO-<today in warehouse time zone>`.

### US-05.3 Move stock between bins — done

_As Paula, I want to move stock between bins without disturbing units reserved for orders._ · FR-046, FR-048 · SP-040

- **Given** a bin with 10 on hand and 6 allocated, **when** I move 5, **then** I get `409 INSUFFICIENT_AVAILABLE` with `available: 4`; moving 4 succeeds.
- **Given** source and destination are the same bin, **when** I submit, **then** I get `400`.

### US-05.4 Correct stock with a reason — done

_As Ivan, I want adjustments to require a reason code so that every correction is explainable._ · FR-047 · SP-040

- **Given** I adjust −3 with reason `DAMAGED`, **when** it is posted, **then** an `ADJUST_OUT` movement of 3 with reason `DAMAGED` is appended.
- **Given** a bin holds 2 available, **when** I adjust −5, **then** I get `409` and on-hand is unchanged.

### US-05.5 History that cannot be rewritten — done

_As Ivan, I want the movement ledger to be append-only so that nobody can hide a correction._ · FR-049 · SP-040

- **Given** direct database access, **when** someone runs `UPDATE` or `DELETE` on `inventory_movements`, **then** the statement fails with "inventory_movements is append-only".

### US-05.6 Page through movements — done

_As Ivan, I want to page backwards through a bin's movements so that I can reconstruct what happened._ · FR-050 · SP-040

- **Given** 7 movements and `limit=3`, **when** I follow `meta.nextCursor` as `before`, **then** I get pages of 3, 3 and 1 with no overlap, newest first.

### US-05.7 Trust the on-hand figures — done

_As Omar, I want to verify stored balances against a full ledger replay so that drift is detected, not assumed away._ · FR-051, FR-053 · SP-041

- **Given** a sequence of receipts, moves, adjustments, allocations and releases, **when** I call projection verify, **then** `consistent` is `true`.
- **Given** a balance row was altered outside the application, **when** I verify, **then** the mismatch is listed with expected and actual on-hand and allocated.

### US-05.8 See stock by bin — done

_As Wendy, I want stock on hand by bin with available quantities and expiry warnings so that I can act before stock expires._ · FR-052, FR-054 · SP-041, SP-061

- **Given** stock in several bins, **when** I open _Stock on hand_, **then** rows are in pick-sequence order with on-hand, allocated, available and pack breakdown.
- **Given** a lot expires in 10 days, **when** the row renders, **then** the expiry cell is flagged as a warning; if already expired, as danger.
- **Given** a row with zero available, **when** it renders, **then** no _Move_ action is offered.

### US-05.9 Put stock on hold — pending

_As Ivan, I want to quarantine a lot so that it stays on hand but cannot be allocated._ · FR-055 · SP-042

- **Given** lot `L7` is put on `QA` hold, **when** an order is allocated, **then** `L7` is excluded with reason `ON_HOLD`.

### US-05.10 Know stock at a past moment — pending

_As Amara, I want stock as of month-end so that client statements match._ · FR-056, FR-057 · SP-043, SP-044

- **Given** a timestamp last month, **when** I query balances as of then, **then** the result equals a full replay to that instant.

### US-05.11 Approve large adjustments — pending

_As Wendy, I want large adjustments approved by a second person so that shrinkage cannot be hidden._ · FR-058 · SP-045

- **Given** an adjustment above the threshold, **when** Ivan posts it, **then** it waits for approval by another manager before reaching the ledger.

---

## E06 — Allocation

### US-06.1 Ship the shortest-dated good stock first — done

_As Wendy, I want FEFO allocation that skips expired and short-dated lots so that customers receive stock with enough shelf life._ · FR-059, FR-060 · SP-050, SP-051

- **Given** lots expiring in 5, 40 and 200 days and `minShelfLifeDays: 30`, **when** I allocate under FEFO, **then** the 40-day lot is used first and the 5-day lot is excluded as `SHORT_SHELF_LIFE`.
- **Given** a lot expired yesterday, **when** I allocate under FIFO, **then** it is excluded as `EXPIRED` even though it is the oldest.
- **Given** a lot expiring exactly on `today + minShelfLifeDays`, **when** I allocate, **then** it is eligible.

### US-06.2 Choose the rotation rule — done

_As Amara, I want FIFO for non-perishables and LIFO where a client asks for it, with a per-order override._ · FR-059, FR-063 · SP-050, SP-051

- **Given** a SKU defaulting to FEFO, **when** I allocate with `strategy: "FIFO"`, **then** the oldest receipt is used and the line records FIFO.
- **Given** LIFO, **when** I allocate, **then** the newest receipt is used first.

### US-06.3 Fewer pick touches — done

_As Paula, I want an allocation to send me to as few bins as possible._ · FR-061 · SP-050

- **Given** bins of the same lot hold 30, 12 and 8 and the order needs 10, **when** allocation runs, **then** the 12 bin is chosen alone.
- **Given** the order needs 45, **when** allocation runs, **then** the 30 bin then the 12 bin then 3 from the 8 bin are used.

### US-06.4 Partial or all-or-nothing — done

_As Wendy, I want to choose between partial allocation and ship-complete so that customers who refuse split shipments get nothing rather than half an order._ · FR-062 · SP-050, SP-051

- **Given** 20 available and an order for 30 with `shipComplete: false`, **when** allocated, **then** status is `PARTIAL` with 20 allocated.
- **Given** the same with `shipComplete: true`, **when** allocated, **then** I get `409 INSUFFICIENT_STOCK` with `shortfall: 30` and nothing is reserved.

### US-06.5 Order lines in cases — done

_As Wendy, I want to allocate multi-line orders in any pack unit so that orders match how customers buy._ · FR-063 · SP-051

- **Given** a line of 1 CS where CS = 12, **when** allocated, **then** 12 EA are reserved.
- **Given** two lines for the same SKU, **when** allocated, **then** they never reserve the same units.

### US-06.6 Never promise the same case twice — done

_As Wendy, I want concurrent allocations to be safe so that two orders never get the last case._ · FR-064 · SP-051

- **Given** 39 eligible units and 12 simultaneous ship-complete orders of 5, **when** they run concurrently, **then** exactly 7 succeed, 5 get `409`, 35 units are allocated, and projection verify reports consistent.

### US-06.7 One live allocation per order — done

_As Wendy, I want duplicate submissions rejected so that a double click does not reserve stock twice._ · FR-065 · SP-051

- **Given** order `SO-1001` is allocated, **when** it is submitted again, **then** I get `409 ALREADY_EXISTS`; after release it can be allocated again.

### US-06.8 Review and release allocations — done

_As Wendy, I want to see where each order's stock is reserved and release it when an order is cancelled._ · FR-066, FR-067, FR-068 · SP-051, SP-055, SP-061

- **Given** an allocation, **when** I open it, **then** I see each line's strategy, requested and allocated quantities and picks by bin, lot and expiry.
- **Given** I release it, **when** the release commits, **then** one `DEALLOCATE` movement per pick is appended, status becomes `RELEASED`, and the units are available again.
- **Given** it is already released, **when** I release again, **then** I get `409 ALREADY_RELEASED`.

### US-06.9 Client-specific allocation rules — pending

_As Amara, I want per-client rules (e.g. 90 days minimum shelf life for a grocery client) so that contracts are honoured automatically._ · FR-069 · SP-052

- **Given** client Birch requires 90 days, **when** an order requests 30, **then** 90 is applied.

### US-06.10 Full cases from reserve — pending

_As Paula, I want full-case quantities taken from reserve and eaches from the pick face so that faces are not emptied by bulk orders._ · FR-070 · SP-053

- **Given** an order for 30 EA with CS = 12, **when** allocated, **then** 2 CS come from reserve and 6 EA from the pick face.

### US-06.11 Fill backorders automatically — pending

_As Wendy, I want short lines retried when stock arrives so that I do not re-key orders._ · FR-071 · SP-054

- **Given** a backorder for 10, **when** 12 units are received, **then** the oldest backorder is allocated first.

---

## E07 — Inbound & receiving

### US-07.1 Expect inbound freight — pending

_As Ravi, I want ASNs loaded before the truck arrives so that I know what to expect._ · FR-072 · SP-070

- **Given** a supplier ASN CSV, **when** imported, **then** an `EXPECTED` ASN with all lines appears on the dock schedule.

### US-07.2 Receive against the ASN and report differences — pending

_As Ravi, I want to receive against the ASN and have shorts and overs reported so that supplier claims are accurate._ · FR-073 · SP-071

- **Given** an ASN line for 10 CS, **when** I receive 9 CS and close the ASN, **then** the discrepancy report shows a short of 1 CS (12 EA).

### US-07.3 Receive with a scanner — pending

_As Ravi, I want a phone-friendly receiving flow so that I can work at the trailer._ · FR-074 · SP-072

- **Given** I scan the ASN, SKU, lot and expiry, **when** I confirm the quantity, **then** the receipt posts in at most 4 taps.

### US-07.4 Inspect before release — pending

_As Ivan, I want flagged SKUs quarantined until QA passes them._ · FR-075 · SP-073

- **Given** a SKU requires inspection, **when** received, **then** it lands in quarantine on hold until an inspection passes.

---

## E08 — Putaway & slotting

### US-08.1 Tell me where to put it — pending

_As Ravi, I want the system to suggest a putaway bin that fits so that I do not search for space._ · FR-076 · SP-080

- **Given** a pallet of a frozen SKU, **when** I ask for a suggestion, **then** only frozen-zone bins with enough capacity are offered, existing bins of the same lot first.

### US-08.2 Confirm putaway by scanning — pending

_As Ravi, I want to confirm putaway by scanning the bin so that stock is where the system says._ · FR-077 · SP-081

- **Given** a putaway task, **when** I scan the suggested bin, **then** a `MOVE` from receiving is posted; scanning another bin asks for a reason.

### US-08.3 Re-slot fast movers — pending

_As Wendy, I want recommendations to move fast movers closer to the start of the pick path._ · FR-078 · SP-082

- **Given** 90 days of picks, **when** I run slotting, **then** A items in distant bins are listed with the expected travel saving.

---

## E09 — Outbound orders & waves

### US-09.1 Take in orders — pending

_As Amara, I want clients' orders imported by API or CSV so that nothing is re-keyed._ · FR-079 · SP-090

- **Given** a CSV of 500 orders, **when** imported, **then** 500 `NEW` orders exist with their carriers and ship dates.

### US-09.2 Track order status — pending

_As Wendy, I want each order to follow a defined lifecycle so that I can see what is stuck._ · FR-080 · SP-091

- **Given** an order is `PICKED`, **when** someone cancels it, **then** the transition is refused with `409`.

### US-09.3 Plan waves by cut-off — pending

_As Wendy, I want orders grouped into waves by carrier cut-off so that the earliest trucks are worked first._ · FR-081 · SP-092

- **Given** orders for a 14:00 and a 17:00 cut-off, **when** I plan waves, **then** the 14:00 orders form the first wave.

### US-09.4 Release a wave — pending

_As Wendy, I want releasing a wave to create pick tasks in path order so that pickers can start immediately._ · FR-082 · SP-093

- **Given** a planned wave, **when** I release it, **then** pick tasks exist grouped by zone and the wave cannot be released again.

---

## E10 — Picking & pick paths

### US-10.1 Shortest walk — pending

_As Paula, I want my picks sequenced along the shortest route so that I walk less._ · FR-083 · SP-100

- **Given** 25 picks across 6 aisles, **when** the path is computed, **then** it is no longer than the serpentine order and shows the estimated distance.

### US-10.2 Confirm or short a pick — pending

_As Paula, I want to confirm picks by scanning and report shorts quickly._ · FR-084 · SP-101

- **Given** a pick of 6 where only 4 are found, **when** I report a short, **then** 4 are picked, the missing 2 are adjusted out pending count, and the shortfall is re-allocated from another bin.

### US-10.3 Pick several orders at once — pending

_As Paula, I want to batch small orders into one trip._ · FR-085 · SP-102

- **Given** 8 single-line orders in one zone, **when** batched, **then** I visit each bin once and each pick goes to the correct tote.

### US-10.4 Pick from my phone — pending

_As Paula, I want a simple mobile pick screen._ · FR-086 · SP-103

- **Given** a released task, **when** I open it, **then** I see one pick at a time with bin, SKU, lot and pack breakdown.

---

## E11 — Packing & cartonization

### US-11.1 Maintain carton types — pending

_As Omar, I want our carton sizes recorded so that cartonization uses real boxes._ · FR-087 · SP-110

- **Given** carton `C3` 400×300×300 mm, max 20 kg, **when** I list carton types, **then** it appears with its dimensions.

### US-11.2 Pick the right box — pending

_As a packer, I want the system to recommend cartons so that we stop shipping air._ · FR-088 · SP-111

- **Given** an order's items, **when** cartonization runs, **then** no carton is overweight or overfilled, and average fill on the benchmark set is ≥ 75%.

### US-11.3 Verify every item at the pack bench — pending

_As a packer, I want each scan checked against the order so that wrong items never ship._ · FR-089 · SP-112

- **Given** an open pack session, **when** I scan an item not on the order, **then** it is refused.

---

## E12 — Shipping

### US-12.1 Build manifests — pending

_As Wendy, I want shipments grouped into carrier manifests so that the driver signs one document._ · FR-090, FR-092 · SP-120, SP-122

- **Given** 40 packed cartons for one carrier, **when** I close the day, **then** a manifest and bill of lading list all 40.

### US-12.2 Estimate freight cost — pending

_As Amara, I want local rate tables so that clients see expected freight cost._ · FR-091 · SP-121

- **Given** a 12 kg carton to zone 4, **when** rated, **then** the larger of actual and dimensional weight is priced.

### US-12.3 Confirm shipment — pending

_As Wendy, I want ship confirmation to remove stock from inventory exactly once._ · FR-093 · SP-123

- **Given** a packed shipment, **when** I confirm it twice, **then** on-hand and allocated drop once and the order is `SHIPPED`.

---

## E13 — Cycle counting

### US-13.1 Plan counts by value — pending

_As Ivan, I want A items counted more often than C items._ · FR-094 · SP-130

- **Given** ABC classes, **when** I plan the month, **then** every A bin is included and C bins are spread over the year.

### US-13.2 Count blind — pending

_As a counter, I want to count without seeing the expected quantity so that counts are honest._ · FR-095 · SP-131

- **Given** a count task, **when** I open it, **then** only bin, SKU and lot are shown.

### US-13.3 Approve variances — pending

_As Ivan, I want variances approved before posting._ · FR-096 · SP-132

- **Given** a variance of −2, **when** I approve, **then** an `ADJUST_OUT` of 2 with reason `CORRECTION` is posted.

---

## E14 — Replenishment

### US-14.1 Set min/max per pick face — pending

_As Wendy, I want min/max levels per pick face._ · FR-097 · SP-140

- **Given** face `P-01-03-0-A` min 24, max 96 in `CS` = 12, **when** I list rules, **then** the rule appears.

### US-14.2 Top up pick faces — pending

_As Paula, I want replenishment tasks before a face runs dry._ · FR-098, FR-099 · SP-141, SP-142

- **Given** the face has 20 available, **when** replenishment runs, **then** a task moves 6 CS (72 EA) from reserve by FEFO, bringing it to 92 (the largest whole number of cases that does not exceed 96).

---

## E15 — Returns

### US-15.1 Authorise a return — pending

_As Amara, I want returns authorised against shipped orders._ · FR-100 · SP-150

- **Given** 5 units shipped, **when** an RMA for 6 is requested, **then** it is refused.

### US-15.2 Receive and disposition returns — pending

_As Ravi, I want to restock, quarantine or scrap returned items._ · FR-101 · SP-151

- **Given** 3 returned units, 1 damaged, **when** received, **then** 2 are restocked and 1 is scrapped with reason `DAMAGED`.

---

## E16 — Labels & handling units

### US-16.1 Print barcodes in-house — pending

_As Omar, I want Code128 barcodes rendered as SVG without a third-party service._ · FR-102 · SP-160

- **Given** the text `A-03-12-2-B`, **when** encoded, **then** the SVG scans back to the same text.

### US-16.2 Print labels — pending

_As Ravi, I want bin, LPN, carton and shipping labels from templates._ · FR-103 · SP-161

- **Given** bin `A-03-12-2-B`, **when** I print its label, **then** a 2×1 in label shows the barcode and the code in text.

### US-16.3 Move a pallet with one scan — pending

_As Paula, I want to move whole pallets by LPN._ · FR-104 · SP-162

- **Given** LPN `LP000123` holds 4 cases, **when** I move it, **then** all contents move in one command.

---

## E17 — Reporting & billing

### US-17.1 Watch the floor — pending

_As Wendy, I want an operations dashboard of backlog and throughput._ · FR-105 · SP-170

- **Given** today's activity, **when** I open the dashboard, **then** it shows inbound, pick and ship backlog refreshed at least every minute.

### US-17.2 Expiry exposure and aging — pending

_As Amara, I want aging and expiry exposure per client._ · FR-106 · SP-171

- **Given** stock expiring within 30 days, **when** I run the report, **then** those lots are listed with quantities.

### US-17.3 Export the ledger — pending

_As Ivan, I want the ledger as CSV for auditors._ · FR-107 · SP-172

- **Given** a month range, **when** exported, **then** movement totals reconcile with balances.

### US-17.4 Get notified — pending

_As Wendy, I want in-app notifications and email through a local outbox._ · FR-108 · SP-173

- **Given** a user is invited, **when** the invite is created, **then** an outbox email exists.

### US-17.5 Bill clients — pending

_As Amara, I want storage and handling charges computed from the ledger._ · FR-109 · SP-174

- **Given** a client's rate card, **when** I run billing for a month, **then** each charge line references the balances or movements it came from.

---

## E18 — Operations & hardening

### US-18.1 Measure throughput and latency — pending

_As Omar, I want metrics and load tests so that performance is known before peak._ · NFR-019, NFR-020 · SP-180, SP-181

- **Given** the load test profile, **when** it runs, **then** allocation p95 is under 250 ms with zero oversells.

### US-18.2 Restore from backup — pending

_As Omar, I want automated restore drills so that backups are proven._ · NFR-022 · SP-182

- **Given** last night's backup, **when** the drill runs, **then** the restored database passes projection verification.

### US-18.3 Harden for scale-out — pending

_As Omar, I want throttles shared across instances and an ASVS L2 review._ · NFR-021 · SP-183, SP-190

- **Given** two API instances, **when** an attacker alternates between them, **then** the per-email limit still applies.

### US-18.4 Accessible UI and end-to-end tests — pending

_As Omar, I want WCAG 2.1 AA and a browser suite across critical flows._ · NFR-023, NFR-025 · SP-184, SP-185

- **Given** the stock page, **when** navigated by keyboard only, **then** every action is reachable with visible focus.

### US-18.5 Work through network drops — pending

_As Paula, I want scans to queue offline and replay safely._ · FR-112, NFR-026 · SP-187

- **Given** Wi-Fi drops for 3 minutes, **when** it returns, **then** my queued confirmations replay once each, in order.

### US-18.6 Labour and dock scheduling — pending

_As Wendy, I want units-per-hour by person and dock appointments._ · FR-110, FR-111 · SP-188, SP-189

- **Given** two carriers request the same door and slot, **when** the second books, **then** it is refused.

### US-18.7 Scale the ledger — pending

_As Omar, I want the ledger partitioned by month so that it stays fast at 100 million rows._ · NFR-024 · SP-186

- **Given** monthly partitions, **when** a receipt is appended, **then** latency stays within NFR-019 targets.
