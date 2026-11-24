import type { Queryable } from '../../db/pool.js';

export interface BalanceDto {
  binId: string;
  binCode: string;
  zoneCode: string;
  skuId: string;
  skuCode: string;
  skuDescription: string;
  baseUom: string;
  lotId: string;
  lotCode: string;
  expiryDate: string | null;
  onHand: number;
  allocated: number;
  available: number;
  updatedAt: string;
}

export async function queryBalances(
  db: Queryable,
  orgId: string,
  filter: {
    warehouseId: string;
    skuId?: string;
    binId?: string;
    includeEmpty: boolean;
    limit: number;
  },
): Promise<BalanceDto[]> {
  const { rows } = await db.query<BalanceDto>(
    `SELECT sb.bin_id AS "binId", b.code AS "binCode", z.code AS "zoneCode",
            sb.sku_id AS "skuId", s.code AS "skuCode", s.description AS "skuDescription",
            s.base_uom AS "baseUom", sb.lot_id AS "lotId", l.lot_code AS "lotCode",
            l.expiry_date AS "expiryDate", sb.on_hand AS "onHand", sb.allocated,
            sb.on_hand - sb.allocated AS available, sb.updated_at AS "updatedAt"
       FROM stock_balances sb
       JOIN bins b ON b.id = sb.bin_id
       JOIN zones z ON z.id = b.zone_id
       JOIN skus s ON s.id = sb.sku_id
       JOIN lots l ON l.id = sb.lot_id
      WHERE sb.organization_id = $1 AND sb.warehouse_id = $2
        AND ($3::uuid IS NULL OR sb.sku_id = $3)
        AND ($4::uuid IS NULL OR sb.bin_id = $4)
        AND ($5::boolean OR sb.on_hand > 0)
      ORDER BY b.pick_sequence, b.code, s.code, l.expiry_date NULLS LAST, l.lot_code
      LIMIT $6`,
    [
      orgId,
      filter.warehouseId,
      filter.skuId ?? null,
      filter.binId ?? null,
      filter.includeEmpty,
      filter.limit,
    ],
  );
  return rows;
}
