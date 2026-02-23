import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@sj/solana-registry': path.resolve(__dirname, './src/index.ts'),
    },
  },
});
