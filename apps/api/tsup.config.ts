import { defineConfig } from 'tsup';

// The shared workspace package ships TypeScript source, so it is bundled into the
// API output; third-party dependencies stay external and load from node_modules.
export default defineConfig({
  entry: ['src/index.ts', 'src/db/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  noExternal: ['@stockpilot/shared'],
});
