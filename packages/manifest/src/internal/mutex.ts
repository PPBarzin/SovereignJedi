/**
 * In-tab async mutex (MVP)
 *
 * Guardrail (Task 6):
 * - Concurrency handling is MVP-only: in-memory mutex + read → merge → write.
 * - No multi-tab locking is attempted here.
 *
 * Node ESM compatibility:
 * - This module is imported from emitted ESM using an explicit `.js` extension
 *   (e.g. `./internal/mutex.js`). No runtime changes are required here; the
 *   compatibility is ensured by the caller import specifier + TS emit config.
 *
 * This mutex is intentionally tiny and dependency-free.
 */

export type Mutex = {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>
}

export function createMutex(): Mutex {
  let tail: Promise<void> = Promise.resolve()

  return {
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      // Chain onto tail to serialize all callers.
      const previous = tail

      let release!: () => void
      tail = new Promise<void>((resolve) => {
        release = resolve
      })

      // Wait for previous holder to finish.
      await previous

      try {
        return await fn()
      } finally {
        // Always release, even if fn throws.
        release()
      }
    },
  }
}
