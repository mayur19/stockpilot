import type { AllocationStrategy, StockCandidate } from '@stockpilot/shared';
import type { Queryable } from '../../db/pool.js';

/** Zones whose stock may be promised to orders; receiving/quarantine stock may not. */
export const ALLOCATABLE_ZONE_TYPES = ['STORAGE', 'PICK'] as const;

interface CandidateRow {
  sku_id: string;
  bin_id: string;
  bin_code: string;
  pick_sequence: number;
  lot_id: string;
  lot_code: string;
  expiry_date: string | null;
  received_at: Date;
  on_hold: boolean;
  available: number;
}

/**
 * Locks every stock row with available quantity for the given SKUs, in a single
 * statement ordered by (sku_id, id) so that concurrent allocators always acquire
 * row locks in the same order and cannot deadlock (ADR-0011). Under READ COMMITTED
 * a waiter re-evaluates `on_hand > allocated` against the committed row version
 * once the lock is released, so it never sees stale availability.
 */
export async function lockCandidates(
  tx: Queryable,
  orgId: string,
  warehouseId: string,
  skuIds: readonly string[],
): Promise<Record<string, StockCandidate[]>> {
  const { rows } = await tx.query<CandidateRow>(
    `SELECT sb.sku_id, sb.bin_id, b.code AS bin_code, b.pick_sequence, sb.lot_id, l.lot_code,
            l.expiry_date, l.received_at, l.on_hold, sb.on_hand - sb.allocated AS available
       FROM stock_balances sb
       JOIN bins b ON b.id = sb.bin_id AND b.is_active
       JOIN zones z ON z.id = b.zone_id AND z.zone_type = ANY($4::text[])
       JOIN lots l ON l.id = sb.lot_id
      WHERE sb.organization_id = $1 AND sb.warehouse_id = $2 AND sb.sku_id = ANY($3::uuid[])
        AND sb.on_hand > sb.allocated
      ORDER BY sb.sku_id, sb.id
      FOR UPDATE OF sb`,
    [orgId, warehouseId, [...skuIds].sort(), ALLOCATABLE_ZONE_TYPES],
  );
  const bySku: Record<string, StockCandidate[]> = {};
  for (const row of rows) {
    const list = bySku[row.sku_id] ?? [];
    list.push({
      binId: row.bin_id,
      binCode: row.bin_code,
      pickSequence: row.pick_sequence,
      lotId: row.lot_id,
      lotCode: row.lot_code,
      expiryDate: row.expiry_date,
      receivedAt: row.received_at.toISOString(),
      available: row.available,
      onHold: row.on_hold,
    });
    bySku[row.sku_id] = list;
  }
  return bySku;
}

export async function insertAllocation(
  tx: Queryable,
  input: {
    orgId: string;
    warehouseId: string;
    orderRef: string;
    status: 'ALLOCATED' | 'PARTIAL';
    shipComplete: boolean;
    minShelfLifeDays: number | null;
    correlationId: string;
    createdBy: string;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO allocations (organization_id, warehouse_id, order_ref, status, ship_complete,
                              min_shelf_life_days, correlation_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.orgId,
      input.warehouseId,
      input.orderRef,
      input.status,
      input.shipComplete,
      input.minShelfLifeDays,
      input.correlationId,
      input.createdBy,
    ],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertLine(
  tx: Queryable,
  line: {
    allocationId: string;
    lineNo: number;
    skuId: string;
    strategy: AllocationStrategy;
    requested: number;
    allocated: number;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO allocation_lines (allocation_id, line_no, sku_id, strategy, requested_qty, allocated_qty)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [line.allocationId, line.lineNo, line.skuId, line.strategy, line.requested, line.allocated],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertPick(
  tx: Queryable,
  pick: { lineId: string; binId: string; lotId: string; quantity: number },
): Promise<void> {
  await tx.query(
    'INSERT INTO allocation_picks (allocation_line_id, bin_id, lot_id, quantity) VALUES ($1, $2, $3, $4)',
    [pick.lineId, pick.binId, pick.lotId, pick.quantity],
  );
}

export interface AllocationHeader {
  id: string;
  warehouseId: string;
  orderRef: string;
  status: 'ALLOCATED' | 'PARTIAL' | 'RELEASED';
  shipComplete: boolean;
  minShelfLifeDays: number | null;
  createdAt: string;
  releasedAt: string | null;
}

const HEADER_COLUMNS = `id, warehouse_id AS "warehouseId", order_ref AS "orderRef", status,
  ship_complete AS "shipComplete", min_shelf_life_days AS "minShelfLifeDays",
  created_at AS "createdAt", released_at AS "releasedAt"`;

export async function findAllocation(
  db: Queryable,
  orgId: string,
  allocationId: string,
  forUpdate = false,
): Promise<AllocationHeader | null> {
  const { rows } = await db.query<AllocationHeader>(
    `SELECT ${HEADER_COLUMNS} FROM allocations WHERE organization_id = $1 AND id = $2
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [orgId, allocationId],
  );
  return rows[0] ?? null;
}

export async function listAllocations(
  db: Queryable,
  orgId: string,
  warehouseId: string,
  limit: number,
): Promise<AllocationHeader[]> {
  const { rows } = await db.query<AllocationHeader>(
    `SELECT ${HEADER_COLUMNS} FROM allocations WHERE organization_id = $1 AND warehouse_id = $2
      ORDER BY created_at DESC LIMIT $3`,
    [orgId, warehouseId, limit],
  );
  return rows;
}

export interface PickRow {
  lineId: string;
  lineNo: number;
  skuId: string;
  skuCode: string;
  strategy: AllocationStrategy;
  requested: number;
  allocatedQty: number;
  binId: string | null;
  binCode: string | null;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  quantity: number | null;
}

export async function loadLinesWithPicks(db: Queryable, allocationId: string): Promise<PickRow[]> {
  const { rows } = await db.query<PickRow>(
    `SELECT al.id AS "lineId", al.line_no AS "lineNo", al.sku_id AS "skuId", s.code AS "skuCode",
            al.strategy, al.requested_qty AS requested, al.allocated_qty AS "allocatedQty",
            p.bin_id AS "binId", b.code AS "binCode", p.lot_id AS "lotId", l.lot_code AS "lotCode",
            l.expiry_date AS "expiryDate", p.quantity
       FROM allocation_lines al
       JOIN skus s ON s.id = al.sku_id
       LEFT JOIN allocation_picks p ON p.allocation_line_id = al.id
       LEFT JOIN bins b ON b.id = p.bin_id
       LEFT JOIN lots l ON l.id = p.lot_id
      WHERE al.allocation_id = $1
      ORDER BY al.line_no, b.pick_sequence, b.code`,
    [allocationId],
  );
  return rows;
}

export async function markReleased(tx: Queryable, allocationId: string): Promise<void> {
  await tx.query("UPDATE allocations SET status = 'RELEASED', released_at = now() WHERE id = $1", [
    allocationId,
  ]);
}
