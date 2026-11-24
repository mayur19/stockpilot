import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TrustProxy } from './config/env.js';
import type { AppContext } from './context.js';
import { registerErrorHandling } from './http/error-handler.js';
import { registerAllocationRoutes } from './modules/allocation/allocation.routes.js';
import { registerAuth } from './modules/auth/auth.plugin.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerCatalogRoutes } from './modules/catalog/catalog.routes.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerInventoryRoutes } from './modules/inventory/inventory.routes.js';
import { registerPendingRoutes } from './modules/pending/pending.routes.js';
import { registerTopologyRoutes } from './modules/topology/topology.routes.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cache-control': 'no-store',
};

/**
 * Maps TRUST_PROXY to Fastify's option. Never `true`: only the configured hop count
 * or proxy list may influence request.ip, which feeds the per-IP throttles.
 * A hop count trusts the nearest N proxies, exactly as proxy-addr does for numbers.
 */
export function trustProxyOption(
  value: TrustProxy,
): false | string[] | ((address: string, hop: number) => boolean) {
  if (value === false) return false;
  if (typeof value === 'number') return (_address, hop) => hop < value;
  return value;
}

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger:
      ctx.env.LOG_LEVEL === 'silent'
        ? false
        : {
            level: ctx.env.LOG_LEVEL,
            redact: [
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
            ],
          },
    bodyLimit: 256 * 1024,
    trustProxy: trustProxyOption(ctx.env.TRUST_PROXY),
    requestIdHeader: false,
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) void reply.header(name, value);
  });

  void app.register(cookie);
  registerErrorHandling(app);
  registerAuth(app, ctx);

  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerTopologyRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerInventoryRoutes(app, ctx);
  registerAllocationRoutes(app, ctx);
  registerPendingRoutes(app);

  return app;
}
