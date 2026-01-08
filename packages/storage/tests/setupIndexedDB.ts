// Vitest setup file: provide a fake IndexedDB implementation in Node/jsdom tests.
//
// This file is referenced by `packages/storage/package.json` (vitest.setupFiles) and
// is executed before the package tests run. It installs `fake-indexeddb` and
// attempts to keep the environment clean by removing any existing databases
// before/after each test.
//
// Note: `fake-indexeddb/auto` populates `globalThis.indexedDB`, `IDBKeyRange`, etc.
// We still guard usage in case of different environments.
//
// Keep this file small and side-effect free so it can run reliably in CI/test runners.

// Import the auto polyfill which sets up global indexedDB in Node.
// @ts-ignore - fake-indexeddb has no types we rely on here.
import 'fake-indexeddb/auto'

import { beforeEach, afterEach } from 'vitest'

/**
 * Clear all known IndexedDB databases (best-effort).
 *
 * Many IndexedDB implementations expose `indexedDB.databases()` which returns
 * a list of database info objects; fake-indexeddb implements this. If the
 * function is not available we fall back to a no-op to avoid throwing.
 */
async function clearAllDatabases(): Promise<void> {
  const anyIndexedDB = (indexedDB as unknown) as any

  if (typeof anyIndexedDB?.databases === 'function') {
    try {
      const dbs: Array<{ name?: string } | undefined> = await anyIndexedDB.databases()
      await Promise.all(
        dbs
          .filter((d) => d && typeof d.name === 'string')
          .map(
            (d) =>
              new Promise<void>((resolve) => {
                try {
                  const req = indexedDB.deleteDatabase(d!.name!)
                  req.onsuccess = () => resolve()
                  req.onerror = () => resolve()
                  req.onblocked = () => resolve()
                } catch {
                  // ignore and resolve — best-effort cleanup
                  resolve()
                }
              })
          )
      )
    } catch {
      // ignore errors from listing/deleting; this is a best-effort cleanup
    }
  }
  // If `databases()` is not available we can't reliably enumerate DBs.
  // Tests should use isolated DB names (the storage tests do) and clean up after themselves.
}

// Ensure a clean state before each test run in this package
beforeEach(async () => {
  await clearAllDatabases()
})

// Also try to clean up after each test to avoid leaking state between tests
afterEach(async () => {
  await clearAllDatabases()
})

// Export nothing — setup file only
export {}
