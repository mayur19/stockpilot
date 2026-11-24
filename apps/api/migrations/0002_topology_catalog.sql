-- Warehouse topology, SKU catalogue with UoM ladders, lots (SP-020, SP-030, SP-031)

CREATE TABLE warehouses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code             text NOT NULL,
  name             text NOT NULL,
  timezone         text NOT NULL DEFAULT 'UTC',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE zones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  warehouse_id     uuid NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL,
  zone_type        text NOT NULL
                   CHECK (zone_type IN ('RECEIVING', 'STORAGE', 'PICK', 'STAGING', 'SHIPPING', 'QUARANTINE')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses (organization_id, id) ON DELETE CASCADE,
  UNIQUE (warehouse_id, code),
  UNIQUE (warehouse_id, id)
);

CREATE TABLE bins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  warehouse_id     uuid NOT NULL,
  zone_id          uuid NOT NULL,
  code             text NOT NULL,
  pick_sequence    integer NOT NULL DEFAULT 0 CHECK (pick_sequence >= 0),
  max_weight_g     bigint CHECK (max_weight_g > 0),
  max_volume_cm3   bigint CHECK (max_volume_cm3 > 0),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (warehouse_id, zone_id) REFERENCES zones (warehouse_id, id) ON DELETE CASCADE,
  UNIQUE (warehouse_id, code),
  UNIQUE (warehouse_id, id)
);
CREATE INDEX bins_zone_idx ON bins (zone_id);

CREATE TABLE skus (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  description       text NOT NULL,
  base_uom          text NOT NULL,
  uom_levels        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ "code": "CS", "factor": 12 }]
  lot_tracked       boolean NOT NULL DEFAULT false,
  expiry_tracked    boolean NOT NULL DEFAULT false,
  default_strategy  text NOT NULL DEFAULT 'FIFO' CHECK (default_strategy IN ('FEFO', 'FIFO', 'LIFO')),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  CHECK (NOT expiry_tracked OR lot_tracked)
);

CREATE TABLE lots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  sku_id           uuid NOT NULL REFERENCES skus (id) ON DELETE CASCADE,
  lot_code         text NOT NULL,
  expiry_date      date,
  received_at      timestamptz NOT NULL DEFAULT now(),
  on_hold          boolean NOT NULL DEFAULT false,
  UNIQUE (sku_id, lot_code)
);
CREATE INDEX lots_expiry_idx ON lots (sku_id, expiry_date);
