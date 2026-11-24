import pg from 'pg';
import type { Env } from '../config/env.js';

// int8 (bigint) columns hold quantities bounded by MAX_QUANTITY, so they are safe JS numbers.
pg.types.setTypeParser(20, (value: string) => Number(value));
// Keep DATE columns as plain YYYY-MM-DD strings; never shift them through local time.
pg.types.setTypeParser(1082, (value: string) => value);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

/** Minimal query surface; lets repositories accept a pool or a transaction client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export function createPool(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_MAX'>): Db {
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/** Run `work` inside a READ COMMITTED transaction; rolls back on any thrown error. */
export async function withTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
