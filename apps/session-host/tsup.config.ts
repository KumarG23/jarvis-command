import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Contracts ship as TypeScript source; bundle them. node-pty is native and stays external.
  noExternal: ['@jarvis-command/contracts'],
  external: ['node-pty'],
});
