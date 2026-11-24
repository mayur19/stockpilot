import type { Queryable } from '../../db/pool.js';

export interface AuditEntry {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Audit write path (SP-014). Called inside the same transaction as the change. */
export async function recordAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.organizationId,
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.requestId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
