import { describe, it, expect, vi, afterEach } from 'vitest'

import { catBytes } from '../src/client'

describe('catBytes', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects empty cid', async () => {
    await expect(catBytes('')).rejects.toThrow('catBytes: cid must be a non-empty string')
    await expect(catBytes('   ')).rejects.toThrow('catBytes: cid must be a non-empty string')
    await expect(catBytes((null as any) as string)).rejects.toThrow('catBytes: cid must be a non-empty string')
  })

  it('uses Kubo /api/v0/cat (POST) and returns bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    const fetchMock = vi.fn(async (url: any, init?: any) => {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => ab,
      } as any
    })

    globalThis.fetch = fetchMock as any

    const cid = 'bafy-test-cid'
    const out = await catBytes(cid, { timeoutMs: 50 })

    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as any[]
    expect(String(calledUrl)).toContain('/api/v0/cat?arg=')
    expect(String(calledUrl)).toContain(encodeURIComponent(cid))
    expect(calledInit?.method).toBe('POST')
  })

  it(
    'Kubo: aborts on timeout when fetch is stuck (does not rely on fake timers)',
    async () => {
      // Avoid fake timers here: AbortController/fetch interaction can be environment-dependent under fakes.
      const fetchMock = vi.fn((_url: any, init?: any) => {
        const signal = init?.signal as AbortSignal | undefined

        return new Promise((resolve, reject) => {
          if (!signal) return
          if (signal.aborted) {
            reject(new Error('aborted'))
            return
          }
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'))
            },
            { once: true }
          )
        }) as any
      })

      globalThis.fetch = fetchMock as any

      await expect(catBytes('bafy-timeout', { timeoutMs: 5 })).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
    10_000
  )
})
