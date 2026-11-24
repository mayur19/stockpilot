import { allocationSchema, limitSchema } from '@stockpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { ok } from '../../http/envelope.js';
import { parse } from '../../http/validate.js';
import { requireAuth } from '../auth/auth.plugin.js';
import { requireWarehouse } from '../topology/topology.routes.js';
import { listAllocations } from './allocation.repository.js';
import { allocateOrder, getAllocation, releaseAllocation } from './allocation.service.js';

const idParams = z.object({ allocationId: z.string().uuid() });
const listQuery = z.object({ warehouseId: z.string().uuid(), limit: limitSchema });

export function registerAllocationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/v1/allocations',
    { config: { permission: 'allocation:write' } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parse(allocationSchema, request.body);
      return reply.status(201).send(ok(await allocateOrder(ctx, auth, input, request.id)));
    },
  );

  app.get('/api/v1/allocations', { config: { permission: 'allocation:read' } }, async (request) => {
    const auth = requireAuth(request);
    const query = parse(listQuery, request.query);
    await requireWarehouse(ctx.db, auth.organizationId, query.warehouseId);
    return ok(await listAllocations(ctx.db, auth.organizationId, query.warehouseId, query.limit));
  });

  app.get(
    '/api/v1/allocations/:allocationId',
    { config: { permission: 'allocation:read' } },
    async (request) => {
      const auth = requireAuth(request);
      const { allocationId } = parse(idParams, request.params);
      return ok(await getAllocation(ctx, auth.organizationId, allocationId));
    },
  );

  app.post(
    '/api/v1/allocations/:allocationId/release',
    { config: { permission: 'allocation:write' } },
    async (request) => {
      const auth = requireAuth(request);
      const { allocationId } = parse(idParams, request.params);
      return ok(await releaseAllocation(ctx, auth, allocationId, request.id));
    },
  );
}
