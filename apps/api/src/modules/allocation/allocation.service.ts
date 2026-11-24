import { randomUUID } from 'node:crypto';
import {
  planOrderAllocation,
  toBaseUnits,
  type AllocationInput,
  type AllocationStrategy,
  type OrderAllocationPlan,
} from '@stockpilot/shared';
import type { AppContext, AuthContext } from '../../context.js';
import { withTransaction, type Queryable } from '../../db/pool.js';
import { conflict, notFound } from '../../http/errors.js';
import { recordAudit } from '../audit/audit.repository.js';
import { findSkusByIds, type SkuDto } from '../catalog/catalog.repository.js';
import { ladderOf, todayIn } from '../inventory/inventory.service.js';
import { appendMovement } from '../inventory/ledger.repository.js';
import { requireWarehouse } from '../topology/topology.routes.js';
import * as repo from './allocation.repository.js';

export interface AllocationLineView {
  lineNo: number;
  skuId: string;
  skuCode: string;
  strategy: AllocationStrategy;
  requested: number;
  allocated: number;
  picks: {
    binId: string;
    binCode: string;
    lotId: string;
    lotCode: string;
    expiryDate: string | null;
    quantity: number;
  }[];
}

export interface AllocationView extends repo.AllocationHeader {
  lines: AllocationLineView[];
}

async function loadSkus(
  db: Queryable,
  orgId: string,
  input: AllocationInput,
): Promise<Map<string, SkuDto>> {
  const ids = [...new Set(input.lines.map((line) => line.skuId))];
  const skus = await findSkusByIds(db, orgId, ids);
  const byId = new Map(skus.map((sku) => [sku.id, sku] as const));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw notFound(`SKU ${missing.join(', ')}`);
  }
  return byId;
}

function shortfallError(plan: OrderAllocationPlan) {
  return conflict('INSUFFICIENT_STOCK', 'Not enough eligible stock to allocate this order', {
    lines: plan.lines.map((line) => ({
      lineNo: Number(line.lineId),
      skuId: line.skuId,
      requested: line.requested,
      shortfall: line.shortfall,
      excluded: line.excluded.length,
    })),
  });
}

/**
 * Allocates an order inside one transaction (ADR-0010, ADR-0011):
 * lock candidates -> plan in pure code -> persist plan + ALLOCATE ledger entries.
 */
export async function allocateOrder(
  ctx: AppContext,
  auth: AuthContext,
  input: AllocationInput,
  requestId: string,
): Promise<AllocationView> {
  const orgId = auth.organizationId;
  const allocationId = await withTransaction(ctx.db, async (tx) => {
    const warehouse = await requireWarehouse(tx, orgId, input.warehouseId);
    const skus = await loadSkus(tx, orgId, input);
    const lines = input.lines.map((line, index) => {
      const sku = skus.get(line.skuId) as SkuDto;
      return {
        lineId: String(index + 1),
        skuId: sku.id,
        quantity: toBaseUnits(ladderOf(sku), line.quantity, line.uom ?? sku.baseUom),
      };
    });
    const strategyBySku: Record<string, AllocationStrategy> = {};
    for (const sku of skus.values()) strategyBySku[sku.id] = input.strategy ?? sku.defaultStrategy;

    const candidates = await repo.lockCandidates(tx, orgId, warehouse.id, [...skus.keys()]);
    const plan = planOrderAllocation(
      {
        lines,
        strategyBySku,
        shipComplete: input.shipComplete,
        today: todayIn(warehouse.timezone),
        ...(input.minShelfLifeDays !== undefined
          ? { minShelfLifeDays: input.minShelfLifeDays }
          : {}),
      },
      candidates,
    );
    if (plan.status === 'NONE') throw shortfallError(plan);

    const correlationId = randomUUID();
    const id = await repo.insertAllocation(tx, {
      orgId,
      warehouseId: warehouse.id,
      orderRef: input.orderRef,
      status: plan.status === 'FULL' ? 'ALLOCATED' : 'PARTIAL',
      shipComplete: input.shipComplete,
      minShelfLifeDays: input.minShelfLifeDays ?? null,
      correlationId,
      createdBy: auth.userId,
    });
    for (const line of plan.lines) {
      const lineId = await repo.insertLine(tx, {
        allocationId: id,
        lineNo: Number(line.lineId),
        skuId: line.skuId,
        strategy: strategyBySku[line.skuId] as AllocationStrategy,
        requested: line.requested,
        allocated: line.allocated,
      });
      for (const pick of line.picks) {
        await repo.insertPick(tx, {
          lineId,
          binId: pick.binId,
          lotId: pick.lotId,
          quantity: pick.quantity,
        });
        await appendMovement(
          tx,
          {
            organizationId: orgId,
            warehouseId: warehouse.id,
            actorUserId: auth.userId,
            correlationId,
            reference: input.orderRef,
          },
          {
            type: 'ALLOCATE',
            skuId: line.skuId,
            lotId: pick.lotId,
            fromBinId: pick.binId,
            toBinId: null,
            quantity: pick.quantity,
          },
        );
      }
    }
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: auth.userId,
      action: 'allocation.created',
      entityType: 'allocation',
      entityId: id,
      requestId,
      metadata: { orderRef: input.orderRef, status: plan.status },
    });
    return id;
  });
  return getAllocation(ctx, orgId, allocationId);
}

export async function getAllocation(
  ctx: AppContext,
  orgId: string,
  allocationId: string,
): Promise<AllocationView> {
  const header = await repo.findAllocation(ctx.db, orgId, allocationId);
  if (!header) throw notFound('Allocation');
  const rows = await repo.loadLinesWithPicks(ctx.db, allocationId);
  const lines = new Map<number, AllocationLineView>();
  for (const row of rows) {
    const line = lines.get(row.lineNo) ?? {
      lineNo: row.lineNo,
      skuId: row.skuId,
      skuCode: row.skuCode,
      strategy: row.strategy,
      requested: row.requested,
      allocated: row.allocatedQty,
      picks: [],
    };
    if (row.binId && row.lotId && row.quantity !== null) {
      line.picks.push({
        binId: row.binId,
        binCode: row.binCode ?? '',
        lotId: row.lotId,
        lotCode: row.lotCode ?? '',
        expiryDate: row.expiryDate,
        quantity: row.quantity,
      });
    }
    lines.set(row.lineNo, line);
  }
  return { ...header, lines: [...lines.values()] };
}

/** Returns every reserved unit to available stock with compensating DEALLOCATE entries. */
export async function releaseAllocation(
  ctx: AppContext,
  auth: AuthContext,
  allocationId: string,
  requestId: string,
): Promise<AllocationView> {
  const orgId = auth.organizationId;
  await withTransaction(ctx.db, async (tx) => {
    const header = await repo.findAllocation(tx, orgId, allocationId, true);
    if (!header) throw notFound('Allocation');
    if (header.status === 'RELEASED') {
      throw conflict('ALREADY_RELEASED', 'This allocation has already been released');
    }
    const correlationId = randomUUID();
    const rows = await repo.loadLinesWithPicks(tx, allocationId);
    for (const row of rows) {
      if (!row.binId || !row.lotId || row.quantity === null) continue;
      await appendMovement(
        tx,
        {
          organizationId: orgId,
          warehouseId: header.warehouseId,
          actorUserId: auth.userId,
          correlationId,
          reference: header.orderRef,
        },
        {
          type: 'DEALLOCATE',
          skuId: row.skuId,
          lotId: row.lotId,
          fromBinId: row.binId,
          toBinId: null,
          quantity: row.quantity,
        },
      );
    }
    await repo.markReleased(tx, allocationId);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: auth.userId,
      action: 'allocation.released',
      entityType: 'allocation',
      entityId: allocationId,
      requestId,
    });
  });
  return getAllocation(ctx, orgId, allocationId);
}
