import {
  applyEffect,
  balanceKeyOf,
  effectsOf,
  type Balance,
  type BalanceKey,
  type Movement,
} from '@stockpilot/shared';
import type { Queryable } from '../../db/pool.js';

export interface MovementContext {
  readonly organizationId: string;
  readonly warehouseId: string;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly reference?: string | null;
  readonly reason?: string | null;
}

interface BalanceRow {
  bin_id: string;
  sku_id: string;
  lot_id: string;
  on_hand: number;
  allocated: number;
}

const toBalance = (row: BalanceRow): Balance => ({
  binId: row.bin_id,
  skuId: row.sku_id,
  lotId: row.lot_id,
  onHand: row.on_hand,
  allocated: row.allocated,
});

/**
 * Locks (creating if needed) the projection row for a key. Must run inside a
 * transaction. Callers lock keys in a deterministic order to avoid deadlocks.
 */
export async function lockBalance(
  tx: Queryable,
  orgId: string,
  warehouseId: string,
  key: BalanceKey,
): Promise<Balance> {
  await tx.query(
    `INSERT INTO stock_balances (organization_id, warehouse_id, bin_id, sku_id, lot_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (bin_id, sku_id, lot_id) DO NOTHING`,
    [orgId, warehouseId, key.binId, key.skuId, key.lotId],
  );
  const { rows } = await tx.query<BalanceRow>(
    `SELECT bin_id, sku_id, lot_id, on_hand, allocated FROM stock_balances
      WHERE bin_id = $1 AND sku_id = $2 AND lot_id = $3 FOR UPDATE`,
    [key.binId, key.skuId, key.lotId],
  );
  return toBalance(rows[0] as BalanceRow);
}

/**
 * Appends a movement to the ledger and applies its effects to the projection in
 * the same transaction (ADR-0009). Domain invariants are checked by the shared
 * `applyEffect`; the table CHECK constraints are a second line of defence.
 */
export async function appendMovement(
  tx: Queryable,
  context: MovementContext,
  movement: Movement,
): Promise<{ movementId: number; balances: Balance[] }> {
  const effects = [...effectsOf(movement)].sort((a, b) =>
    balanceKeyOf(a) < balanceKeyOf(b) ? -1 : 1,
  );
  const locked = new Map<string, Balance>();
  for (const effect of effects) {
    locked.set(
      balanceKeyOf(effect),
      await lockBalance(tx, context.organizationId, context.warehouseId, effect),
    );
  }

  const next = new Map<string, Balance>();
  for (const effect of effects) {
    const key = balanceKeyOf(effect);
    const current = next.get(key) ?? (locked.get(key) as Balance);
    next.set(key, applyEffect(current, effect));
  }

  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO inventory_movements
       (organization_id, warehouse_id, sku_id, lot_id, movement_type, from_bin_id, to_bin_id,
        quantity, reason, reference, correlation_id, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      context.organizationId,
      context.warehouseId,
      movement.skuId,
      movement.lotId,
      movement.type,
      movement.fromBinId,
      movement.toBinId,
      movement.quantity,
      context.reason ?? null,
      context.reference ?? null,
      context.correlationId,
      context.actorUserId,
    ],
  );
  const movementId = (rows[0] as { id: number }).id;

  for (const balance of next.values()) {
    await tx.query(
      `UPDATE stock_balances
          SET on_hand = $4, allocated = $5, version = version + 1,
              last_movement_id = $6, updated_at = now()
        WHERE bin_id = $1 AND sku_id = $2 AND lot_id = $3`,
      [balance.binId, balance.skuId, balance.lotId, balance.onHand, balance.allocated, movementId],
    );
  }
  return { movementId, balances: [...next.values()] };
}

export interface MovementDto {
  id: number;
  movementType: Movement['type'];
  skuId: string;
  skuCode: string;
  lotId: string;
  lotCode: string;
  fromBinId: string | null;
  fromBinCode: string | null;
  toBinId: string | null;
  toBinCode: string | null;
  quantity: number;
  reason: string | null;
  reference: string | null;
  correlationId: string;
  actorUserId: string | null;
  occurredAt: string;
}

export async function listMovements(
  db: Queryable,
  orgId: string,
  filter: { warehouseId: string; skuId?: string; binId?: string; before?: number; limit: number },
): Promise<MovementDto[]> {
  const { rows } = await db.query<MovementDto>(
    `SELECT m.id, m.movement_type AS "movementType", m.sku_id AS "skuId", s.code AS "skuCode",
            m.lot_id AS "lotId", l.lot_code AS "lotCode",
            m.from_bin_id AS "fromBinId", fb.code AS "fromBinCode",
            m.to_bin_id AS "toBinId", tb.code AS "toBinCode",
            m.quantity, m.reason, m.reference, m.correlation_id AS "correlationId",
            m.actor_user_id AS "actorUserId", m.occurred_at AS "occurredAt"
       FROM inventory_movements m
       JOIN skus s ON s.id = m.sku_id
       JOIN lots l ON l.id = m.lot_id
       LEFT JOIN bins fb ON fb.id = m.from_bin_id
       LEFT JOIN bins tb ON tb.id = m.to_bin_id
      WHERE m.organization_id = $1 AND m.warehouse_id = $2
        AND ($3::uuid IS NULL OR m.sku_id = $3)
        AND ($4::uuid IS NULL OR m.from_bin_id = $4 OR m.to_bin_id = $4)
        AND ($5::bigint IS NULL OR m.id < $5)
      ORDER BY m.id DESC
      LIMIT $6`,
    [
      orgId,
      filter.warehouseId,
      filter.skuId ?? null,
      filter.binId ?? null,
      filter.before ?? null,
      filter.limit,
    ],
  );
  return rows;
}

/** Streams the ledger in replay order for projection verification. */
export async function loadLedger(db: Queryable, orgId: string): Promise<Movement[]> {
  const { rows } = await db.query<{
    movement_type: Movement['type'];
    sku_id: string;
    lot_id: string;
    from_bin_id: string | null;
    to_bin_id: string | null;
    quantity: number;
  }>(
    `SELECT movement_type, sku_id, lot_id, from_bin_id, to_bin_id, quantity
       FROM inventory_movements WHERE organization_id = $1 ORDER BY id`,
    [orgId],
  );
  return rows.map((row) => ({
    type: row.movement_type,
    skuId: row.sku_id,
    lotId: row.lot_id,
    fromBinId: row.from_bin_id,
    toBinId: row.to_bin_id,
    quantity: row.quantity,
  }));
}

export async function loadStoredBalances(db: Queryable, orgId: string): Promise<Balance[]> {
  const { rows } = await db.query<BalanceRow>(
    'SELECT bin_id, sku_id, lot_id, on_hand, allocated FROM stock_balances WHERE organization_id = $1',
    [orgId],
  );
  return rows.map(toBalance);
}
