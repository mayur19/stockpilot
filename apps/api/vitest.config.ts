import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Pick up TEST_DATABASE_URL from the repository .env when running locally.
const envFile = resolve(__dirname, '../../.env');
if (!process.env.TEST_DATABASE_URL && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Database suites share one disposable schema; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/db/cli.ts', 'src/db/seed.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
