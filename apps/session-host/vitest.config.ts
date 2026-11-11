import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Real tmux servers and PTYs: run files one at a time.
    fileParallelism: false,
  },
});
