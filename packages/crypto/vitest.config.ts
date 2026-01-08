import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Use Node environment because @sj/crypto targets both browser and Node (Node >=18 provides Web Crypto)
    environment: 'node',
    // Provide globals like `describe`, `it`, `expect`
    globals: true,
    // Run tests from the package `tests` folder
    include: ['tests/**/*.test.ts'],
    // Some crypto operations may not play nicely with worker threads in certain environments;
    // disabling threads avoids isolation issues when accessing globalThis.crypto.
    threads: false,
    // Allow a bit more time for crypto operations on CI
    timeout: 10000,
    // If you need to run a setup script (for example to polyfill globalThis.crypto on older Node),
    // add its path here (e.g. 'tests/setup.ts'). Left empty by default.
    setupFiles: [],
  },
  // Keep the config minimal and focused on fast, deterministic tests for crypto primitives
})
