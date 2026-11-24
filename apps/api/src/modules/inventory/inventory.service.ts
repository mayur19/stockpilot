import { randomUUID } from 'node:crypto';
import {
  assertIsoDate,
  breakdownQuantity,
  createUomLadder,
  diffBalances,
  formatBreakdown,
  projectBalances,
  toBaseUnits,
  type AdjustmentInput,
  type MoveInput,
  type ReceiptInput,
} from '@stockpilot/shared';
import type { AppContext, AuthContext } from '../../context.js';
import { withTransaction, type Queryable } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { recordAudit } from '../audit/audit.repository.js';
import * as catalog from '../catalog/catalog.repository.js';
import { findBin } from '../topology/topology.repository.js';
import { requireWarehouse } from '../topology/topology.routes.js';
import { appendMovement, loadLedger, loadStoredBalances } from './ledger.repository.js';

export function ladderOf(sku: catalog.SkuDto) {
  return createUomLadder(sku.baseUom, sku.uomLevels);
}

export function describeQuantity(sku: catalog.SkuDto, baseQuantity: number): string {
  return formatBreakdown(breakdownQuantity(ladderOf(sku), baseQuantity));
}

export async function requireSku(db: Queryable, orgId: string, skuId: string) {
  const sku = await catalog.findSku(db, orgId, skuId);
  if (!sku) throw notFound('SKU');
  return sku;
}

async function requireBinIn(db: Queryable, orgId: string, warehouseId: string, binId: string) {
  const bin = await findBin(db, orgId, warehouseId, binId);
  if (!bin) throw notFound('Bin');
  if (!bin.isActive) throw conflict('BIN_INACTIVE', `Bin ${bin.code} is inactive`);
  return bin;
}

function receiptLot(sku: catalog.SkuDto, input: ReceiptInput, today: string) {
  if (sku.lotTracked && !input.lotCode) {
    throw badRequest('This SKU is lot tracked; lotCode is required', [
      { path: 'lotCode', message: 'Required' },
    ]);
  }
  if (!sku.lotTracked && input.lotCode) {
    throw badRequest('This SKU is not lot tracked; omit lotCode', [
      { path: 'lotCode', message: 'Not allowed' },
    ]);
  }
  if (sku.expiryTracked && !input.expiryDate) {
    throw badRequest('This SKU tracks expiry; expiryDate is required', [
      { path: 'expiryDate', message: 'Required' },
    ]);
  }
  if (!sku.expiryTracked && input.expiryDate) {
    throw badRequest('This SKU does not track expiry; omit expiryDate', [
      { path: 'expiryDate', message: 'Not allowed' },
    ]);
  }
  const expiryDate = input.expiryDate ? assertIsoDate(input.expiryDate, 'expiryDate') : null;
  // Untracked SKUs get one system lot per receipt day so FIFO still has an age to sort by.
  const lotCode = input.lotCode?.toUpperCase() ?? `AUTO-${today.replaceAll('-', '')}`;
  return { lotCode, expiryDate };
}

export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

export async function receiveStock(
  ctx: AppContext,
  auth: AuthContext,
  input: ReceiptInput,
  requestId: string,
) {
  const orgId = auth.organizationId;
  return withTransaction(ctx.db, async (tx) => {
    const warehouse = await requireWarehouse(tx, orgId, input.warehouseId);
    const bin = await requireBinIn(tx, orgId, warehouse.id, input.binId);
    const sku = await requireSku(tx, orgId, input.skuId);
    const quantity = toBaseUnits(ladderOf(sku), input.quantity, input.uom ?? sku.baseUom);
    const { lotCode, expiryDate } = receiptLot(sku, input, todayIn(warehouse.timezone));
    const lot = await catalog.upsertLot(tx, orgId, { skuId: sku.id, lotCode, expiryDate });
    if (lot.expiryDate !== expiryDate) {
      throw conflict(
        'LOT_EXPIRY_MISMATCH',
        `Lot ${lotCode} is already recorded with a different expiry`,
        {
          lotCode,
          recorded: lot.expiryDate,
          received: expiryDate,
        },
      );
    }
    const correlationId = randomUUID();
    const result = await appendMovement(
      tx,
      {
        organizationId: orgId,
        warehouseId: warehouse.id,
        actorUserId: auth.userId,
        correlationId,
        reference: input.reference ?? null,
      },
      { type: 'RECEIPT', skuId: sku.id, lotId: lot.id, fromBinId: null, toBinId: bin.id, quantity },
    );
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: auth.userId,
      action: 'inventory.received',
      entityType: 'inventory_movement',
      entityId: String(result.movementId),
      requestId,
      metadata: { skuId: sku.id, binId: bin.id, lotId: lot.id, quantity },
    });
    return {
      movementId: result.movementId,
      correlationId,
      lot,
      quantity,
      quantityDescription: describeQuantity(sku, quantity),
      balance: result.balances[0],
    };
  });
}

export async function moveStock(
  ctx: AppContext,
  auth: AuthContext,
  input: MoveInput,
  requestId: string,
) {
  const orgId = auth.organizationId;
  if (input.fromBinId === input.toBinId) {
    throw badRequest('Source and destination bins must differ', [
      { path: 'toBinId', message: 'Same as fromBinId' },
    ]);
  }
  return withTransaction(ctx.db, async (tx) => {
    const warehouse = await requireWarehouse(tx, orgId, input.warehouseId);
    const from = await requireBinIn(tx, orgId, warehouse.id, input.fromBinId);
    const to = await requireBinIn(tx, orgId, warehouse.id, input.toBinId);
    const sku = await requireSku(tx, orgId, input.skuId);
    const lot = await catalog.findLot(tx, orgId, input.lotId);
    if (!lot || lot.skuId !== sku.id) throw notFound('Lot');
    const quantity = toBaseUnits(ladderOf(sku), input.quantity, input.uom ?? sku.baseUom);
    const correlationId = randomUUID();
    const result = await appendMovement(
      tx,
      {
        organizationId: orgId,
        warehouseId: warehouse.id,
        actorUserId: auth.userId,
        correlationId,
        reference: input.reference ?? null,
      },
      { type: 'MOVE', skuId: sku.id, lotId: lot.id, fromBinId: from.id, toBinId: to.id, quantity },
    );
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: auth.userId,
      action: 'inventory.moved',
      entityType: 'inventory_movement',
      entityId: String(result.movementId),
      requestId,
      metadata: { skuId: sku.id, fromBinId: from.id, toBinId: to.id, lotId: lot.id, quantity },
    });
    return { movementId: result.movementId, correlationId, quantity, balances: result.balances };
  });
}

export async function adjustStock(
  ctx: AppContext,
  auth: AuthContext,
  input: AdjustmentInput,
  requestId: string,
) {
  const orgId = auth.organizationId;
  return withTransaction(ctx.db, async (tx) => {
    const warehouse = await requireWarehouse(tx, orgId, input.warehouseId);
    const bin = await requireBinIn(tx, orgId, warehouse.id, input.binId);
    const sku = await requireSku(tx, orgId, input.skuId);
    const lot = await catalog.findLot(tx, orgId, input.lotId);
    if (!lot || lot.skuId !== sku.id) throw notFound('Lot');
    const increase = input.delta > 0;
    const correlationId = randomUUID();
    const result = await appendMovement(
      tx,
      {
        organizationId: orgId,
        warehouseId: warehouse.id,
        actorUserId: auth.userId,
        correlationId,
        reason: input.reason,
        reference: input.note ?? null,
      },
      {
        type: increase ? 'ADJUST_IN' : 'ADJUST_OUT',
        skuId: sku.id,
        lotId: lot.id,
        fromBinId: increase ? null : bin.id,
        toBinId: increase ? bin.id : null,
        quantity: Math.abs(input.delta),
      },
    );
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: auth.userId,
      action: 'inventory.adjusted',
      entityType: 'inventory_movement',
      entityId: String(result.movementId),
      requestId,
      metadata: {
        skuId: sku.id,
        binId: bin.id,
        lotId: lot.id,
        delta: input.delta,
        reason: input.reason,
      },
    });
    return { movementId: result.movementId, correlationId, balance: result.balances[0] };
  });
}

/** Re-folds the whole ledger and compares it with the stored projection (SP-041). */
export async function verifyProjection(ctx: AppContext, orgId: string) {
  // One REPEATABLE READ snapshot so concurrent writes cannot produce phantom drift.
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const ledger = await loadLedger(client, orgId);
    const stored = await loadStoredBalances(client, orgId);
    await client.query('COMMIT');
    const mismatches = diffBalances(projectBalances(ledger), stored);
    return {
      consistent: mismatches.length === 0,
      movementCount: ledger.length,
      balanceCount: stored.length,
      mismatches,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
