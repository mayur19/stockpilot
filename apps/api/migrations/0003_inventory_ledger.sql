-- Event-sourced inventory ledger, on-hand projection, allocations (SP-040, SP-041, SP-051)

CREATE TABLE inventory_movements (
  id               bigserial PRIMARY KEY,           -- global ordering for replay
  organization_id  uuid NOT NULL REFERENCES organizations (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  sku_id           uuid NOT NULL REFERENCES skus (id),
  lot_id           uuid NOT NULL REFERENCES lots (id),
  movement_type    text NOT NULL
                   CHECK (movement_type IN ('RECEIPT', 'MOVE', 'ADJUST_IN', 'ADJUST_OUT', 'ALLOCATE', 'DEALLOCATE')),
  from_bin_id      uuid REFERENCES bins (id),
  to_bin_id        uuid REFERENCES bins (id),
  quantity         bigint NOT NULL CHECK (quantity > 0),
  reason           text,
  reference        text,
  correlation_id   uuid NOT NULL,                   -- groups the movements of one command
  actor_user_id    uuid REFERENCES users (id),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_bin_id IS NOT NULL OR to_bin_id IS NOT NULL),
  CHECK (from_bin_id IS DISTINCT FROM to_bin_id)
);
CREATE INDEX inventory_movements_org_wh_idx ON inventory_movements (organization_id, warehouse_id, id DESC);
CREATE INDEX inventory_movements_sku_idx ON inventory_movements (sku_id, id DESC);
CREATE INDEX inventory_movements_correlation_idx ON inventory_movements (correlation_id);

-- The ledger is append-only: corrections are new compensating movements.
CREATE FUNCTION reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TABLE stock_balances (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  bin_id           uuid NOT NULL REFERENCES bins (id),
  sku_id           uuid NOT NULL REFERENCES skus (id),
  lot_id           uuid NOT NULL REFERENCES lots (id),
  on_hand          bigint NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  allocated        bigint NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  version          integer NOT NULL DEFAULT 0,
  last_movement_id bigint REFERENCES inventory_movements (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Backstop for the allocation engine: available can never go negative.
  CONSTRAINT stock_balances_allocated_le_on_hand CHECK (allocated <= on_hand),
  UNIQUE (bin_id, sku_id, lot_id)
);
CREATE INDEX stock_balances_lookup_idx ON stock_balances (organization_id, warehouse_id, sku_id)
  WHERE on_hand > 0;

CREATE TABLE allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id),
  warehouse_id        uuid NOT NULL REFERENCES warehouses (id),
  order_ref           text NOT NULL,
  status              text NOT NULL CHECK (status IN ('ALLOCATED', 'PARTIAL', 'RELEASED')),
  ship_complete       boolean NOT NULL,
  min_shelf_life_days integer,
  correlation_id      uuid NOT NULL,
  created_by          uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  released_at         timestamptz
);
-- One live allocation per order reference per warehouse.
CREATE UNIQUE INDEX allocations_open_order_key ON allocations (organization_id, warehouse_id, order_ref)
  WHERE status <> 'RELEASED';

CREATE TABLE allocation_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id      uuid NOT NULL REFERENCES allocations (id) ON DELETE CASCADE,
  line_no            integer NOT NULL,
  sku_id             uuid NOT NULL REFERENCES skus (id),
  strategy           text NOT NULL CHECK (strategy IN ('FEFO', 'FIFO', 'LIFO')),
  requested_qty      bigint NOT NULL CHECK (requested_qty > 0),
  allocated_qty      bigint NOT NULL CHECK (allocated_qty >= 0 AND allocated_qty <= requested_qty),
  UNIQUE (allocation_id, line_no)
);

CREATE TABLE allocation_picks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_line_id uuid NOT NULL REFERENCES allocation_lines (id) ON DELETE CASCADE,
  bin_id             uuid NOT NULL REFERENCES bins (id),
  lot_id             uuid NOT NULL REFERENCES lots (id),
  quantity           bigint NOT NULL CHECK (quantity > 0)
);
CREATE INDEX allocation_picks_line_idx ON allocation_picks (allocation_line_id);
