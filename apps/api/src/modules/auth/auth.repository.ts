import type { Role } from '@stockpilot/shared';
import type { Queryable } from '../../db/pool.js';

export interface UserRow {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
}

export interface SessionContextRow {
  session_id: string;
  csrf_token: string;
  expires_at: Date;
  user_id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  name: string;
  role: Role;
}

export async function insertOrganization(db: Queryable, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
    [name],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertUser(
  db: Queryable,
  user: { organizationId: string; email: string; name: string; passwordHash: string; role: Role },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (organization_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, organization_id, email, name, password_hash, role, is_active`,
    [user.organizationId, user.email, user.name, user.passwordHash, user.role],
  );
  return rows[0] as UserRow;
}

export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, organization_id, email, name, password_hash, role, is_active
       FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function touchLogin(db: Queryable, userId: string): Promise<void> {
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
}

export async function insertSession(
  db: Queryable,
  session: {
    id: string;
    userId: string;
    organizationId: string;
    csrfToken: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id, user_id, organization_id, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      session.id,
      session.userId,
      session.organizationId,
      session.csrfToken,
      session.expiresAt,
      session.ip,
      session.userAgent,
    ],
  );
}

export async function findSessionContext(
  db: Queryable,
  sessionId: string,
): Promise<SessionContextRow | null> {
  const { rows } = await db.query<SessionContextRow>(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
            u.id AS user_id, u.organization_id, o.name AS organization_name,
            u.email, u.name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.is_active
       JOIN organizations o ON o.id = u.organization_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function deleteSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function touchSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(
    "UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'",
    [sessionId],
  );
}
