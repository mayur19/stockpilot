import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { createAuthThrottle } from './http/rate-limiter.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createPool(env);
  const throttle = createAuthThrottle(env, {
    onWarning: (event, detail) =>
      app.log.warn({ event, ...detail }, 'auth throttle store under pressure'),
  });
  const app = buildApp({ env, db, throttle });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
