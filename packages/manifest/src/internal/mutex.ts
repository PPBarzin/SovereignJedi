/**
 * In-tab async mutex (MVP)
 *
 * Guardrail (Task 6):
 * - Concurrency handling is MVP-only: in-memory mutex + read → merge → write.
 * - No multi-tab locking is attempted here.
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
