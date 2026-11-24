import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import { withTransaction, type Db } from './pool.js';

/**
 * Forward-only SQL migration runner (ADR-0007).
 * Files: apps/api/migrations/NNNN_description.sql, applied in lexical order, each in
 * its own transaction. Checksums guard against editing applied migrations.
 */
export function defaultMigrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'migrations');
}

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export async function loadMigrations(
  dir: string = defaultMigrationsDir(),
): Promise<readonly MigrationFile[]> {
  const entries = (await readdir(dir)).filter((file) => MIGRATION_FILE.test(file)).sort();
  return Promise.all(
    entries.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

export async function runMigrations(
  db: Db,
  logger: Logger,
  dir?: string,
): Promise<readonly string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Map(
    (
      await db.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations',
      )
    ).rows.map((row) => [row.name, row.checksum] as const),
  );

  const migrations = await loadMigrations(dir);
  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    const existing = applied.get(migration.name);
    if (existing !== undefined) {
      if (existing !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} was modified after being applied; add a new migration instead`,
        );
      }
      continue;
    }
    await withTransaction(db, async (tx) => {
      await tx.query(migration.sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    });
    logger.info({ migration: migration.name }, 'migration applied');
    newlyApplied.push(migration.name);
  }

  return newlyApplied;
}
