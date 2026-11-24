import type { ZoneType } from '@stockpilot/shared';
import type { Queryable } from '../../db/pool.js';

export interface WarehouseDto {
  id: string;
  code: string;
  name: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
}

export interface ZoneDto {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  zoneType: ZoneType;
}

export interface BinDto {
  id: string;
  warehouseId: string;
  zoneId: string;
  zoneCode: string;
  code: string;
  pickSequence: number;
  maxWeightGrams: number | null;
  maxVolumeCm3: number | null;
  isActive: boolean;
}

const WAREHOUSE_COLUMNS = `id, code, name, timezone, is_active AS "isActive", created_at AS "createdAt"`;

export async function insertWarehouse(
  db: Queryable,
  orgId: string,
  input: { code: string; name: string; timezone: string },
): Promise<WarehouseDto> {
  const { rows } = await db.query<WarehouseDto>(
    `INSERT INTO warehouses (organization_id, code, name, timezone) VALUES ($1, $2, $3, $4)
     RETURNING ${WAREHOUSE_COLUMNS}`,
    [orgId, input.code, input.name, input.timezone],
  );
  return rows[0] as WarehouseDto;
}

export async function listWarehouses(db: Queryable, orgId: string): Promise<WarehouseDto[]> {
  const { rows } = await db.query<WarehouseDto>(
    `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE organization_id = $1 ORDER BY code`,
    [orgId],
  );
  return rows;
}

export async function findWarehouse(
  db: Queryable,
  orgId: string,
  warehouseId: string,
): Promise<WarehouseDto | null> {
  const { rows } = await db.query<WarehouseDto>(
    `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE organization_id = $1 AND id = $2`,
    [orgId, warehouseId],
  );
  return rows[0] ?? null;
}

export async function insertZone(
  db: Queryable,
  orgId: string,
  warehouseId: string,
  input: { code: string; name: string; zoneType: ZoneType },
): Promise<ZoneDto> {
  const { rows } = await db.query<ZoneDto>(
    `INSERT INTO zones (organization_id, warehouse_id, code, name, zone_type) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, warehouse_id AS "warehouseId", code, name, zone_type AS "zoneType"`,
    [orgId, warehouseId, input.code, input.name, input.zoneType],
  );
  return rows[0] as ZoneDto;
}

export async function listZones(
  db: Queryable,
  orgId: string,
  warehouseId: string,
): Promise<ZoneDto[]> {
  const { rows } = await db.query<ZoneDto>(
    `SELECT id, warehouse_id AS "warehouseId", code, name, zone_type AS "zoneType"
       FROM zones WHERE organization_id = $1 AND warehouse_id = $2 ORDER BY code`,
    [orgId, warehouseId],
  );
  return rows;
}

export async function findZone(
  db: Queryable,
  orgId: string,
  warehouseId: string,
  zoneId: string,
): Promise<ZoneDto | null> {
  const { rows } = await db.query<ZoneDto>(
    `SELECT id, warehouse_id AS "warehouseId", code, name, zone_type AS "zoneType"
       FROM zones WHERE organization_id = $1 AND warehouse_id = $2 AND id = $3`,
    [orgId, warehouseId, zoneId],
  );
  return rows[0] ?? null;
}

const BIN_SELECT = `
  SELECT b.id, b.warehouse_id AS "warehouseId", b.zone_id AS "zoneId", z.code AS "zoneCode",
         b.code, b.pick_sequence AS "pickSequence", b.max_weight_g AS "maxWeightGrams",
         b.max_volume_cm3 AS "maxVolumeCm3", b.is_active AS "isActive"
    FROM bins b JOIN zones z ON z.id = b.zone_id`;

export async function insertBin(
  db: Queryable,
  orgId: string,
  warehouseId: string,
  input: {
    zoneId: string;
    code: string;
    pickSequence: number;
    maxWeightGrams: number | null;
    maxVolumeCm3: number | null;
  },
): Promise<BinDto> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bins (organization_id, warehouse_id, zone_id, code, pick_sequence, max_weight_g, max_volume_cm3)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      orgId,
      warehouseId,
      input.zoneId,
      input.code,
      input.pickSequence,
      input.maxWeightGrams,
      input.maxVolumeCm3,
    ],
  );
  return (await findBin(db, orgId, warehouseId, (rows[0] as { id: string }).id)) as BinDto;
}

export async function findBin(
  db: Queryable,
  orgId: string,
  warehouseId: string,
  binId: string,
): Promise<BinDto | null> {
  const { rows } = await db.query<BinDto>(
    `${BIN_SELECT} WHERE b.organization_id = $1 AND b.warehouse_id = $2 AND b.id = $3`,
    [orgId, warehouseId, binId],
  );
  return rows[0] ?? null;
}

export async function listBins(
  db: Queryable,
  orgId: string,
  warehouseId: string,
  zoneId?: string,
): Promise<BinDto[]> {
  const { rows } = await db.query<BinDto>(
    `${BIN_SELECT} WHERE b.organization_id = $1 AND b.warehouse_id = $2
        AND ($3::uuid IS NULL OR b.zone_id = $3)
      ORDER BY b.pick_sequence, b.code`,
    [orgId, warehouseId, zoneId ?? null],
  );
  return rows;
}
