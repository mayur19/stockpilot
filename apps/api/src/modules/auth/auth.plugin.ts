import { hasPermission } from '@stockpilot/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import { forbidden, unauthorized, AppError } from '../../http/errors.js';
import { findSessionContext, touchSession } from './auth.repository.js';
import { safeEqual, sessionIdFor } from './tokens.js';

export const SESSION_COOKIE = 'sp_session';
export const CSRF_COOKIE = 'sp_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function loadAuth(ctx: AppContext, request: FastifyRequest): Promise<void> {
  request.auth = null;
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  const sessionId = sessionIdFor(token, ctx.env.SESSION_SECRET);
  const row = await findSessionContext(ctx.db, sessionId);
  if (!row) return;
  await touchSession(ctx.db, sessionId);
  request.auth = {
    sessionId,
    csrfToken: row.csrf_token,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

function enforce(request: FastifyRequest): void {
  const permission = request.routeOptions.config.permission;
  if (!permission) return;
  const auth = request.auth;
  if (!auth) throw unauthorized();
  if (!SAFE_METHODS.has(request.method)) {
    const header = request.headers[CSRF_HEADER];
    if (typeof header !== 'string' || !safeEqual(header, auth.csrfToken)) {
      throw new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
    }
  }
  if (permission !== 'authenticated' && !hasPermission(auth.role, permission)) {
    throw forbidden();
  }
}

/**
 * Loads the session for every request and enforces the route's declared permission
 * plus the CSRF double-submit check on mutating requests (ADR-0006).
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    await loadAuth(ctx, request);
    enforce(request);
  });
}

export function requireAuth(request: FastifyRequest) {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
