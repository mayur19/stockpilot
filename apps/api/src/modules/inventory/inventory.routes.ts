import {
  adjustmentSchema,
  balanceQuerySchema,
  moveSchema,
  movementQuerySchema,
  receiptSchema,
} from '@stockpilot/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { ok } from '../../http/envelope.js';
import { parse } from '../../http/validate.js';
import { requireAuth } from '../auth/auth.plugin.js';
import { requireWarehouse } from '../topology/topology.routes.js';
import { queryBalances } from './balance.repository.js';
import { adjustStock, moveStock, receiveStock, verifyProjection } from './inventory.service.js';
import { listMovements } from './ledger.repository.js';

export function registerInventoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/v1/inventory/receipts',
    { config: { permission: 'inventory:receive' } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parse(receiptSchema, request.body);
      return reply.status(201).send(ok(await receiveStock(ctx, auth, input, request.id)));
    },
  );

  app.post(
    '/api/v1/inventory/moves',
    { config: { permission: 'inventory:move' } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parse(moveSchema, request.body);
      return reply.status(201).send(ok(await moveStock(ctx, auth, input, request.id)));
    },
  );

  app.post(
    '/api/v1/inventory/adjustments',
    { config: { permission: 'inventory:adjust' } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parse(adjustmentSchema, request.body);
      return reply.status(201).send(ok(await adjustStock(ctx, auth, input, request.id)));
    },
  );

  app.get(
    '/api/v1/inventory/balances',
    { config: { permission: 'inventory:read' } },
    async (request) => {
      const auth = requireAuth(request);
      const query = parse(balanceQuerySchema, request.query);
      await requireWarehouse(ctx.db, auth.organizationId, query.warehouseId);
      const rows = await queryBalances(ctx.db, auth.organizationId, query);
      return ok(rows, { count: rows.length, limit: query.limit });
    },
  );

  app.get(
    '/api/v1/inventory/movements',
    { config: { permission: 'inventory:read' } },
    async (request) => {
      const auth = requireAuth(request);
      const query = parse(movementQuerySchema, request.query);
      await requireWarehouse(ctx.db, auth.organizationId, query.warehouseId);
      const rows = await listMovements(ctx.db, auth.organizationId, query);
      const last = rows[rows.length - 1];
      return ok(rows, {
        limit: query.limit,
        nextCursor: rows.length === query.limit && last ? String(last.id) : null,
      });
    },
  );

  app.get(
    '/api/v1/inventory/projection/verify',
    { config: { permission: 'inventory:verify' } },
    async (request) => {
      const auth = requireAuth(request);
      return ok(await verifyProjection(ctx, auth.organizationId));
    },
  );
}
