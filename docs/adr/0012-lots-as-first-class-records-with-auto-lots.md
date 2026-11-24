# ADR-0012: Lots as first-class records with auto lots for untracked SKUs

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-031; follow-ups SP-032, SP-042

## Context and problem statement

Perishables and regulated goods need lot and expiry tracking for FEFO, recalls and shelf-life rules. Other goods (apparel, hardware) do not have supplier lots, yet FIFO still needs to know how old stock is. If the stock key is sometimes `(bin, sku, lot)` and sometimes `(bin, sku)`, every query, lock and projection needs two code paths. How should lots be modelled?

## Decision drivers

- One uniform stock key for the ledger, projection and allocation.
- FEFO needs expiry; FIFO/LIFO need a receipt timestamp for every unit.
- Holds (quarantine, QA) should be expressible per lot.
- Concurrent receipts of the same new lot must not create duplicates.

## Considered options

1. `lots` table referenced by every movement and balance; lot-tracked SKUs require a lot code; untracked SKUs get a system "auto lot" per receipt day.
2. Nullable `lot_id` on movements and balances.
3. Lot attributes denormalised onto `stock_balances` rows.

## Decision outcome

Chosen option: **1**. `lots (sku_id, lot_code)` is unique and carries `expiry_date` (a calendar `date`, no time zone), `received_at` (first receipt) and `on_hold`. On receipt (`receiptLot` in `inventory.service.ts`):

- lot-tracked SKUs must send `lotCode`; untracked SKUs must not;
- expiry-tracked SKUs must send `expiryDate`; others must not; `skus` has `CHECK (NOT expiry_tracked OR lot_tracked)`;
- untracked SKUs receive into lot `AUTO-YYYYMMDD` for the warehouse's local date, so FIFO has an age per receipt day;
- `upsertLot` uses `INSERT … ON CONFLICT (sku_id, lot_code) DO UPDATE SET lot_code = EXCLUDED.lot_code RETURNING …`, turning the loser of a concurrent insert into a read; if the existing lot has a different expiry the receipt fails with `409 LOT_EXPIRY_MISMATCH`.

`stock_balances` and `inventory_movements` always have a non-null `lot_id`.

### Consequences

- Good: one key `(bin, sku, lot)` everywhere; the allocation engine treats tracked and untracked SKUs identically.
- Good: lot-level holds already filter allocation (`on_hold` -> `ON_HOLD` exclusion); richer statuses arrive in SP-042.
- Bad: untracked SKUs accumulate one lot row per receipt day; acceptable (365 rows per SKU per year).
- Bad: `received_at` is the first receipt of the lot; later receipts into the same lot do not make it "younger". This matches supplier-lot semantics.
- Neutral: serial numbers (SP-032) will be a child of lots, not a replacement.
