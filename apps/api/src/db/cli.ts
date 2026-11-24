import pino from 'pino';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';
import { seedDemoData } from './seed.js';

/** `tsx src/db/cli.ts migrate|seed|reset` — used by run.sh and npm scripts. */
async function main(): Promise<void> {
  const command = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  const db = createPool({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 2 });
  try {
    switch (command) {
      case 'migrate': {
        const applied = await runMigrations(db, logger);
        logger.info({ applied: applied.length }, 'migrations complete');
        break;
      }
      case 'seed':
        await seedDemoData(db, logger);
        break;
      case 'reset':
        if (process.env.NODE_ENV === 'production')
          throw new Error('Refusing to reset in production');
        await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await runMigrations(db, logger);
        await seedDemoData(db, logger);
        break;
      default:
        throw new Error(`Unknown command "${command ?? ''}" (expected migrate | seed | reset)`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
