import pino from 'pino';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import path from 'node:path';

/** Recreates the disposable test schema once per run and applies all migrations. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('TEST_DATABASE_URL not set: database suites will be skipped');
    return;
  }
  const db = createPool({ DATABASE_URL: url, DATABASE_POOL_MAX: 2 });
  try {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await runMigrations(db, pino({ level: 'silent' }), path.resolve(__dirname, '../migrations'));
  } finally {
    await db.end();
  }
}
