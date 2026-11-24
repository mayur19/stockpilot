import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { ok } from '../../http/envelope.js';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/health', async () =>
    ok({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }),
  );

  app.get('/api/v1/ready', async (_request, reply) => {
    try {
      const { rows } = await ctx.db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      );
      return ok({ status: 'ready', database: 'up', migrations: Number(rows[0]?.count ?? 0) });
    } catch {
      return reply.status(503).send({
        data: null,
        error: { code: 'NOT_READY', message: 'Database is unavailable or not migrated' },
      });
    }
  });
}
