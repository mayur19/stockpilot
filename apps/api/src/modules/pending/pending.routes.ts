import type { FastifyInstance } from 'fastify';
import { sendNotImplemented } from '../../http/not-implemented.js';
import { PENDING_ENDPOINTS } from './pending.catalog.js';

export function registerPendingRoutes(app: FastifyInstance): void {
  for (const endpoint of PENDING_ENDPOINTS) {
    app.route({
      method: endpoint.method,
      url: endpoint.path,
      config: { permission: 'authenticated' },
      handler: async (_request, reply) =>
        sendNotImplemented(reply, endpoint.ticket, endpoint.summary),
    });
  }
}
