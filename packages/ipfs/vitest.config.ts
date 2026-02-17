import { defineConfig } from 'vitest/config'

/**
 * @sj/ipfs — Vitest configuration
 *
 * Task 5 requires unit tests with Helia mocked.
 * These tests should run in Node (no jsdom) and must not require any network.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    reporters: ['default'],
    // Keep tests deterministic and fast by default
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
