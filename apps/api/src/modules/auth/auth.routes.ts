import { loginSchema, registerSchema } from '@stockpilot/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import { ok } from '../../http/envelope.js';
import { parse } from '../../http/validate.js';
import { CSRF_COOKIE, requireAuth, SESSION_COOKIE } from './auth.plugin.js';
import { login, logout, registerOwner, type IssuedSession } from './auth.service.js';

function clientInfo(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];
  return { ip: request.ip ?? null, userAgent: userAgent ?? null, requestId: request.id };
}

function setSessionCookies(ctx: AppContext, reply: FastifyReply, session: IssuedSession): void {
  const secure = ctx.env.NODE_ENV === 'production';
  const common = { path: '/', sameSite: 'lax' as const, secure, expires: session.expiresAt };
  void reply.setCookie(SESSION_COOKIE, session.token, { ...common, httpOnly: true });
  // Readable by the SPA so it can echo it in the X-CSRF-Token header (double submit).
  void reply.setCookie(CSRF_COOKIE, session.csrfToken, { ...common, httpOnly: false });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/v1/auth/register', async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const result = await registerOwner(ctx, input, clientInfo(request));
    return reply.status(202).send(ok(result));
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const session = await login(ctx, input, clientInfo(request));
    setSessionCookies(ctx, reply, session);
    return ok({ user: session.user, csrfToken: session.csrfToken });
  });

  app.post(
    '/api/v1/auth/logout',
    { config: { permission: 'authenticated' } },
    async (request, reply) => {
      const auth = requireAuth(request);
      await logout(ctx, auth.sessionId);
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      void reply.clearCookie(CSRF_COOKIE, { path: '/' });
      return reply.status(204).send();
    },
  );

  app.get('/api/v1/auth/me', { config: { permission: 'authenticated' } }, async (request) => {
    const auth = requireAuth(request);
    return ok({
      user: { id: auth.userId, email: auth.email, name: auth.name, role: auth.role },
      organization: { id: auth.organizationId, name: auth.organizationName },
      csrfToken: auth.csrfToken,
    });
  });
}
