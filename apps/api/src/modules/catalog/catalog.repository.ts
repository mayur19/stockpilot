import type { AllocationStrategy, UomLevel } from '@stockpilot/shared';
import type { Queryable } from '../../db/pool.js';

export interface SkuDto {
  id: string;
  code: string;
  description: string;
  baseUom: string;
  uomLevels: UomLevel[];
  lotTracked: boolean;
  expiryTracked: boolean;
  defaultStrategy: AllocationStrategy;
  isActive: boolean;
}

export interface LotDto {
  id: string;
  skuId: string;
  lotCode: string;
  expiryDate: string | null;
  receivedAt: string;
  onHold: boolean;
}

const SKU_COLUMNS = `id, code, description, base_uom AS "baseUom", uom_levels AS "uomLevels",
  lot_tracked AS "lotTracked", expiry_tracked AS "expiryTracked",
  default_strategy AS "defaultStrategy", is_active AS "isActive"`;

const LOT_COLUMNS = `id, sku_id AS "skuId", lot_code AS "lotCode", expiry_date AS "expiryDate",
  received_at AS "receivedAt", on_hold AS "onHold"`;

export async function insertSku(
  db: Queryable,
  orgId: string,
  input: Omit<SkuDto, 'id' | 'isActive'>,
): Promise<SkuDto> {
  const { rows } = await db.query<SkuDto>(
    `INSERT INTO skus (organization_id, code, description, base_uom, uom_levels, lot_tracked, expiry_tracked, default_strategy)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${SKU_COLUMNS}`,
    [
      orgId,
      input.code,
      input.description,
      input.baseUom,
      JSON.stringify(input.uomLevels),
      input.lotTracked,
      input.expiryTracked,
      input.defaultStrategy,
    ],
  );
  return rows[0] as SkuDto;
}

export async function listSkus(db: Queryable, orgId: string, search?: string): Promise<SkuDto[]> {
  const { rows } = await db.query<SkuDto>(
    `SELECT ${SKU_COLUMNS} FROM skus
      WHERE organization_id = $1
        AND ($2::text IS NULL OR code ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%')
      ORDER BY code LIMIT 200`,
    [orgId, search ?? null],
  );
  return rows;
}

export async function findSku(db: Queryable, orgId: string, skuId: string): Promise<SkuDto | null> {
  const { rows } = await db.query<SkuDto>(
    `SELECT ${SKU_COLUMNS} FROM skus WHERE organization_id = $1 AND id = $2`,
    [orgId, skuId],
  );
  return rows[0] ?? null;
}

export async function findSkusByIds(
  db: Queryable,
  orgId: string,
  ids: readonly string[],
): Promise<SkuDto[]> {
  const { rows } = await db.query<SkuDto>(
    `SELECT ${SKU_COLUMNS} FROM skus WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, ids],
  );
  return rows;
}

export async function listLots(db: Queryable, orgId: string, skuId: string): Promise<LotDto[]> {
  const { rows } = await db.query<LotDto>(
    `SELECT ${LOT_COLUMNS} FROM lots WHERE organization_id = $1 AND sku_id = $2
      ORDER BY expiry_date NULLS LAST, received_at`,
    [orgId, skuId],
  );
  return rows;
}

export async function findLot(db: Queryable, orgId: string, lotId: string): Promise<LotDto | null> {
  const { rows } = await db.query<LotDto>(
    `SELECT ${LOT_COLUMNS} FROM lots WHERE organization_id = $1 AND id = $2`,
    [orgId, lotId],
  );
  return rows[0] ?? null;
}

/**
 * Finds or creates a lot. Concurrent receipts of the same new lot are serialised by
 * the (sku_id, lot_code) unique key: ON CONFLICT turns the loser into a read.
 */
export async function upsertLot(
  db: Queryable,
  orgId: string,
  input: { skuId: string; lotCode: string; expiryDate: string | null },
): Promise<LotDto> {
  const { rows } = await db.query<LotDto>(
    `INSERT INTO lots (organization_id, sku_id, lot_code, expiry_date) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sku_id, lot_code) DO UPDATE SET lot_code = EXCLUDED.lot_code
     RETURNING ${LOT_COLUMNS}`,
    [orgId, input.skuId, input.lotCode, input.expiryDate],
  );
  return rows[0] as LotDto;
}
