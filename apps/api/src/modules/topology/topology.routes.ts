import {
  createBinSchema,
  createWarehouseSchema,
  createZoneSchema,
  defaultPickSequence,
  parseBinCode,
} from '@stockpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Queryable } from '../../db/pool.js';
import { ok } from '../../http/envelope.js';
import { notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { recordAudit } from '../audit/audit.repository.js';
import { requireAuth } from '../auth/auth.plugin.js';
import * as repo from './topology.repository.js';

const warehouseParams = z.object({ warehouseId: z.string().uuid() });
const binListQuery = z.object({ zoneId: z.string().uuid().optional() });

export async function requireWarehouse(db: Queryable, orgId: string, warehouseId: string) {
  const warehouse = await repo.findWarehouse(db, orgId, warehouseId);
  if (!warehouse) throw notFound('Warehouse');
  return warehouse;
}

/**
 * Returns the canonical IANA name for a time zone ("europe/london" -> "Europe/London",
 * "UTC" stays "UTC") or null when unknown. Warehouses store only canonical names so
 * that equal zones compare and cache equally.
 */
export function canonicalTimezone(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function registerTopologyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const read = { config: { permission: 'topology:read' as const } };
  const write = { config: { permission: 'topology:write' as const } };

  app.get('/api/v1/warehouses', read, async (request) => {
    const auth = requireAuth(request);
    return ok(await repo.listWarehouses(ctx.db, auth.organizationId));
  });

  app.post('/api/v1/warehouses', write, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parse(
      createWarehouseSchema
        .refine((v) => canonicalTimezone(v.timezone) !== null, {
          message: 'Unknown IANA time zone',
          path: ['timezone'],
        })
        .transform((v) => ({ ...v, timezone: canonicalTimezone(v.timezone) as string })),
      request.body,
    );
    const warehouse = await repo.insertWarehouse(ctx.db, auth.organizationId, input);
    await recordAudit(ctx.db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'warehouse.created',
      entityType: 'warehouse',
      entityId: warehouse.id,
      requestId: request.id,
    });
    return reply.status(201).send(ok(warehouse));
  });

  app.get('/api/v1/warehouses/:warehouseId', read, async (request) => {
    const auth = requireAuth(request);
    const { warehouseId } = parse(warehouseParams, request.params);
    return ok(await requireWarehouse(ctx.db, auth.organizationId, warehouseId));
  });

  app.get('/api/v1/warehouses/:warehouseId/zones', read, async (request) => {
    const auth = requireAuth(request);
    const { warehouseId } = parse(warehouseParams, request.params);
    await requireWarehouse(ctx.db, auth.organizationId, warehouseId);
    return ok(await repo.listZones(ctx.db, auth.organizationId, warehouseId));
  });

  app.post('/api/v1/warehouses/:warehouseId/zones', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { warehouseId } = parse(warehouseParams, request.params);
    const input = parse(createZoneSchema, request.body);
    await requireWarehouse(ctx.db, auth.organizationId, warehouseId);
    const zone = await repo.insertZone(ctx.db, auth.organizationId, warehouseId, input);
    return reply.status(201).send(ok(zone));
  });

  app.get('/api/v1/warehouses/:warehouseId/bins', read, async (request) => {
    const auth = requireAuth(request);
    const { warehouseId } = parse(warehouseParams, request.params);
    const { zoneId } = parse(binListQuery, request.query);
    await requireWarehouse(ctx.db, auth.organizationId, warehouseId);
    return ok(await repo.listBins(ctx.db, auth.organizationId, warehouseId, zoneId));
  });

  app.post('/api/v1/warehouses/:warehouseId/bins', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { warehouseId } = parse(warehouseParams, request.params);
    const input = parse(createBinSchema, request.body);
    await requireWarehouse(ctx.db, auth.organizationId, warehouseId);
    const zone = await repo.findZone(ctx.db, auth.organizationId, warehouseId, input.zoneId);
    if (!zone) throw notFound('Zone');
    const address = parseBinCode(input.code);
    const bin = await repo.insertBin(ctx.db, auth.organizationId, warehouseId, {
      zoneId: zone.id,
      code: address.code,
      pickSequence: input.pickSequence ?? defaultPickSequence(address),
      maxWeightGrams: input.maxWeightGrams ?? null,
      maxVolumeCm3: input.maxVolumeCm3 ?? null,
    });
    return reply.status(201).send(ok(bin));
  });
}
