import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Use jsdom so IndexedDB is available for storage package tests
    environment: 'jsdom',
    // Provide globals like `describe`, `it`, `expect` without importing
    globals: true,
    // Load setup files before tests (e.g. fake-indexeddb shim)
    setupFiles: ['tests/setupIndexedDB.ts'],
    // Run tests from the package tests folder
    include: ['tests/**/*.test.ts'],
    // Disable worker threads to avoid environment isolation issues with IndexedDB shims
    threads: false,
    // Keep test environment options reasonable for DOM APIs
    environmentOptions: {
      jsdom: {
        // allow external resources if needed by tests (adjust if too permissive)
        resources: 'usable',
        // allow script execution (use with care)
        runScripts: 'dangerously',
      },
    },
    // Optional: set a small timeout for long-running operations (ms)
    timeout: 5000,
  },
})
