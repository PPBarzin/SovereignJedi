import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@sj/solana-registry': path.resolve(__dirname, './src/index.ts'),
      '@sj/manifest': path.resolve(__dirname, '../manifest/src/index.ts'),
      '@sj/crypto': path.resolve(__dirname, '../crypto/src/index.ts'),
      '@sj/ipfs': path.resolve(__dirname, '../ipfs/src/index.ts'),
      'libsodium-wrappers': path.resolve(__dirname, '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.js'),
      './libsodium.mjs': path.resolve(__dirname, '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.js'),
      './libsodium-sumo.mjs': path.resolve(__dirname, '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.js'),
    },
    server: {
      deps: {
        inline: [
          '@sj/manifest',
          '@sj/crypto',
          '@sj/ipfs',
          'libsodium-wrappers',
          'libsodium-wrappers-sumo'
        ],
      },
    },
  },
});
