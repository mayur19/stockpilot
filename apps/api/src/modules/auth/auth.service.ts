import type { LoginInput, RegisterInput } from '@stockpilot/shared';
import type { AppContext } from '../../context.js';
import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { recordAudit } from '../audit/audit.repository.js';
import * as repo from './auth.repository.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import { randomToken, sessionIdFor } from './tokens.js';

export interface IssuedSession {
  readonly token: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly user: { id: string; email: string; name: string; role: string; organizationId: string };
}

interface ClientInfo {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

async function issueSession(
  ctx: AppContext,
  user: repo.UserRow,
  client: ClientInfo,
): Promise<IssuedSession> {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + ctx.env.SESSION_TTL_HOURS * 3_600_000);
  await repo.insertSession(ctx.db, {
    id: sessionIdFor(token, ctx.env.SESSION_SECRET),
    userId: user.id,
    organizationId: user.organization_id,
    csrfToken,
    expiresAt,
    ip: client.ip,
    userAgent: client.userAgent?.slice(0, 300) ?? null,
  });
  return {
    token,
    csrfToken,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organization_id,
    },
  };
}

export const REGISTRATION_ACCEPTED_MESSAGE =
  'If this email can be registered, the workspace is ready. Sign in to continue.';

function tooManyRequests(message: string, retryAfterMs: number): AppError {
  return new AppError(429, 'RATE_LIMITED', message, {
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/**
 * Creates an organisation and its owner account. The response is identical whether
 * or not the email already exists, and no session is issued, so the endpoint cannot
 * be used to enumerate accounts (ADR-0006). The password is hashed before the
 * lookup so both paths cost the same. Email-verified signup through the local
 * outbox replaces this flow in SP-009.
 */
export async function registerOwner(
  ctx: AppContext,
  input: RegisterInput,
  client: ClientInfo,
): Promise<{ status: 'accepted'; message: string }> {
  const ip = client.ip ?? 'unknown';
  const retryAfterMs = ctx.throttle.reserveRegistration(ip);
  if (retryAfterMs > 0) {
    throw tooManyRequests('Too many registration attempts, try again later', retryAfterMs);
  }
  const passwordHash = await hashPassword(input.password);
  try {
    await withTransaction(ctx.db, async (tx) => {
      const existing = await repo.findUserByEmail(tx, input.email);
      if (existing) {
        await recordAudit(tx, {
          organizationId: existing.organization_id,
          actorUserId: null,
          action: 'auth.register_duplicate',
          entityType: 'user',
          entityId: existing.id,
          requestId: client.requestId,
        });
        return;
      }
      const organizationId = await repo.insertOrganization(tx, input.organizationName);
      const created = await repo.insertUser(tx, {
        organizationId,
        email: input.email,
        name: input.name,
        passwordHash,
        role: 'owner',
      });
      await recordAudit(tx, {
        organizationId,
        actorUserId: created.id,
        action: 'organization.registered',
        entityType: 'organization',
        entityId: organizationId,
        requestId: client.requestId,
      });
    });
  } catch (error) {
    // A concurrent registration of the same email lost the race: same answer.
    if (!isUniqueViolation(error)) throw error;
  }
  return { status: 'accepted', message: REGISTRATION_ACCEPTED_MESSAGE };
}

export async function login(
  ctx: AppContext,
  input: LoginInput,
  client: ClientInfo,
): Promise<IssuedSession> {
  const ip = client.ip ?? 'unknown';
  // Reserved synchronously, before the first await, so concurrent attempts cannot
  // all slip past the check; the reservation counts as a failure until it succeeds.
  const retryAfterMs = ctx.throttle.reserveLogin(ip, input.email);
  if (retryAfterMs > 0) {
    throw tooManyRequests('Too many failed login attempts, try again later', retryAfterMs);
  }
  const user = await repo.findUserByEmail(ctx.db, input.email);
  const valid = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid || !user.is_active) {
    await recordAudit(ctx.db, {
      organizationId: user?.organization_id ?? null,
      actorUserId: null,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      requestId: client.requestId,
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  ctx.throttle.recordLoginSuccess(ip, input.email);
  await repo.touchLogin(ctx.db, user.id);
  await recordAudit(ctx.db, {
    organizationId: user.organization_id,
    actorUserId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    requestId: client.requestId,
  });
  return issueSession(ctx, user, client);
}

export async function logout(ctx: AppContext, sessionId: string): Promise<void> {
  await repo.deleteSession(ctx.db, sessionId);
}
