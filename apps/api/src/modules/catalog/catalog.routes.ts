import { createSkuSchema, createUomLadder } from '@stockpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { ok } from '../../http/envelope.js';
import { badRequest, notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { recordAudit } from '../audit/audit.repository.js';
import { requireAuth } from '../auth/auth.plugin.js';
import * as repo from './catalog.repository.js';

const skuParams = z.object({ skuId: z.string().uuid() });
const skuListQuery = z.object({ search: z.string().trim().min(1).max(64).optional() });

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const read = { config: { permission: 'catalog:read' as const } };
  const write = { config: { permission: 'catalog:write' as const } };

  app.get('/api/v1/skus', read, async (request) => {
    const auth = requireAuth(request);
    const { search } = parse(skuListQuery, request.query);
    return ok(await repo.listSkus(ctx.db, auth.organizationId, search));
  });

  app.post('/api/v1/skus', write, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parse(createSkuSchema, request.body);
    if (input.expiryTracked && !input.lotTracked) {
      throw badRequest('Expiry tracking requires lot tracking', [
        { path: 'expiryTracked', message: 'Enable lotTracked as well' },
      ]);
    }
    const ladder = createUomLadder(input.baseUom, input.uomLevels);
    const sku = await repo.insertSku(ctx.db, auth.organizationId, {
      ...input,
      baseUom: ladder.baseUom,
      uomLevels: [...ladder.levels],
    });
    await recordAudit(ctx.db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'sku.created',
      entityType: 'sku',
      entityId: sku.id,
      requestId: request.id,
    });
    return reply.status(201).send(ok(sku));
  });

  app.get('/api/v1/skus/:skuId', read, async (request) => {
    const auth = requireAuth(request);
    const { skuId } = parse(skuParams, request.params);
    const sku = await repo.findSku(ctx.db, auth.organizationId, skuId);
    if (!sku) throw notFound('SKU');
    return ok(sku);
  });

  app.get('/api/v1/skus/:skuId/lots', read, async (request) => {
    const auth = requireAuth(request);
    const { skuId } = parse(skuParams, request.params);
    if (!(await repo.findSku(ctx.db, auth.organizationId, skuId))) throw notFound('SKU');
    return ok(await repo.listLots(ctx.db, auth.organizationId, skuId));
  });
}
