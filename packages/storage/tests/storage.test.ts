import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initStorage,
  putManifest,
  getManifest,
  deleteManifest,
  listManifests,
  getEncryptedManifestBytes,
  toBase64,
  fromBase64
} from '../src/index'

/**
 * Note:
 * These tests rely on an environment that provides IndexedDB (vitest with jsdom + indexedDB shim).
 * Each test initializes a storage instance with a unique database name and deletes it afterwards to avoid collisions.
 */

function randomDbName() {
  return `sj_test_db_${Math.random().toString(36).slice(2)}`
}

function randomWalletId() {
  return `wallet_${Math.random().toString(36).slice(2)}`
}

describe('@sj/storage — basic operations (IndexedDB)', () => {
  let dbName: string
  let db: ReturnType<typeof initStorage>

  beforeEach(() => {
    dbName = randomDbName()
    db = initStorage(dbName)
  })

  afterEach(async () => {
    // delete the underlying IndexedDB database to clean up
    // Be resilient: some Dexie instances expose `delete()` while others (or shims)
    // may require using the global `indexedDB.deleteDatabase` API. Use whichever
    // is available and perform best-effort non-throwing cleanup.
    try {
      if (db && typeof (db as any).delete === 'function') {
        // Dexie instance provides a delete helper
        await (db as any).delete()
      } else if (typeof indexedDB !== 'undefined' && typeof indexedDB.deleteDatabase === 'function') {
        // Fall back to the standard IndexedDB deleteDatabase call
        await new Promise<void>((resolve) => {
          try {
            const req = indexedDB.deleteDatabase(dbName)
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
            req.onblocked = () => resolve()
          } catch {
            // ignore and resolve — best-effort cleanup
            resolve()
          }
        })
      }
    } catch (err) {
      // best-effort cleanup; some environments may not expose delete
      // eslint-disable-next-line no-console
      console.warn('cleanup failed for', dbName, err)
    }
  })

  it('putManifest -> getManifest returns stored payload and metadata', async () => {
    const walletId = randomWalletId()
    const raw = new Uint8Array([1, 2, 3, 4, 5, 250])
    const manifestCid = 'bafyfakecid123'
    // store as Uint8Array (module will base64-encode)
    const res = await putManifest(walletId, raw, manifestCid)

    expect(res).toHaveProperty('walletId', walletId)
    expect(res).toHaveProperty('manifestCid', manifestCid)
    expect(res).toHaveProperty('encryptedManifestB64')

    // retrieve and assert values
    const fetched = await getManifest(walletId)
    expect(fetched).not.toBeNull()
    expect(fetched!.walletId).toBe(walletId)
    expect(fetched!.manifestCid).toBe(manifestCid)
    // returned encrypted manifest is base64; convert back and compare bytes
    const bytes = fromBase64(fetched!.encryptedManifestB64)
    expect(Array.from(bytes)).toEqual(Array.from(raw))
  })

  it('getEncryptedManifestBytes returns the original bytes', async () => {
    const walletId = randomWalletId()
    const content = new Uint8Array([10, 20, 30, 40, 50])
    await putManifest(walletId, content, null)

    const fetchedBytes = await getEncryptedManifestBytes(walletId)
    expect(fetchedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(fetchedBytes!)).toEqual(Array.from(content))
  })

  it('listManifests returns an array including stored manifests', async () => {
    const walletA = randomWalletId()
    const walletB = randomWalletId()
    const contentA = new Uint8Array([1])
    const contentB = new Uint8Array([2, 3])

    await putManifest(walletA, contentA, 'cidA')
    await putManifest(walletB, contentB, 'cidB')

    const all = await listManifests()
    // must contain at least the two we added
    const ids = all.map((p) => p.walletId)
    expect(ids).toEqual(expect.arrayContaining([walletA, walletB]))

    const foundA = all.find((p) => p.walletId === walletA)!
    expect(foundA.manifestCid).toBe('cidA')
    const foundB = all.find((p) => p.walletId === walletB)!
    expect(foundB.manifestCid).toBe('cidB')
  })

  it('deleteManifest removes the entry and subsequent getManifest returns null', async () => {
    const walletId = randomWalletId()
    const content = new Uint8Array([9, 9, 9])
    await putManifest(walletId, content, 'cid-to-delete')

    const before = await getManifest(walletId)
    expect(before).not.toBeNull()

    const ok = await deleteManifest(walletId)
    expect(ok).toBe(true)

    const after = await getManifest(walletId)
    expect(after).toBeNull()
  })

  it('putManifest updates existing entry (updatedAt changes)', async () => {
    const walletId = randomWalletId()
    const first = new Uint8Array([1, 1, 1])
    const second = new Uint8Array([2, 2, 2])

    const r1 = await putManifest(walletId, first, 'cid-v1')
    // small delay to ensure updatedAt differs
    await new Promise((r) => setTimeout(r, 10))
    const r2 = await putManifest(walletId, second, 'cid-v2')

    expect(r2.manifestCid).toBe('cid-v2')
    expect(new Date(r2.updatedAt).getTime()).toBeGreaterThan(new Date(r1.updatedAt).getTime())

    const fetched = await getManifest(walletId)
    expect(fetched).not.toBeNull()
    const bytes = fromBase64(fetched!.encryptedManifestB64)
    expect(Array.from(bytes)).toEqual(Array.from(second))
  })
})
