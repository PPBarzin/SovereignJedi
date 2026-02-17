import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { Envelope } from '@sj/crypto'
import type { EncryptedManifestObjectV1, ManifestEntryV1, ManifestV1 } from '../src/types'
import {
  deriveManifestKey,
  encryptManifestV1,
  decryptManifestV1,
  computeManifestIntegritySha256B64,
} from '../src/crypto'
import { appendEntryAndPersist } from '../src/service'

/**
 * NOTE:
 * These tests intentionally focus on:
 * - Roundtrip: deriveManifestKey -> encryptManifestV1 -> decryptManifestV1
 * - Integrity: rule alignment with Task 5 (sha256 over JSON.stringify(hashBasis) bytes)
 * - Tamper detection: any mutation in hash basis should fail integrity
 * - Mutex: concurrent appends should not lose entries (in-tab mutex)
 *
 * Crypto unit tests inject a sodium stub so they are deterministic and do not depend on a real
 * libsodium runtime being present in the environment.
 *
 * No UI tests here.
 */

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    version: 1,
    walletPubKey: 'wallet-pubkey',
    kekDerivation: {
      method: 'wallet-signature',
      messageTemplateId: 'SJ_UNLOCK_V1',
      salt: 'salt-b64',
      info: 'SJ-KEK-v1',
    },
    wrap: {
      cipher: 'XChaCha20-Poly1305',
      nonce: 'wrap-nonce-b64',
      ciphertext: 'wrap-ciphertext-b64',
      context: 'wrap-aad-v3',
      aadVersion: 3,
    },
    ...overrides,
  }
}

function makeManifest(walletPubKey = 'wallet-pubkey', entries: ManifestEntryV1[] = []): ManifestV1 {
  return {
    version: 1,
    walletPubKey,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entries,
  }
}

function makeEncryptedManifestEnvelope(walletPubKey = 'wallet-pubkey'): EncryptedManifestObjectV1['envelope'] {
  return {
    version: 1,
    walletPubKey,
    kekDerivation: {
      method: 'wallet-signature',
      messageTemplateId: 'SJ_UNLOCK_V1',
      salt: 'salt-b64',
      info: 'SJ-KEK-v1',
    },
    wrap: {
      cipher: 'XChaCha20-Poly1305',
      nonce: 'nonce-b64',
      ciphertext: 'ciphertext-b64',
      context: 'manifest-wrap-aad-v1',
      aadVersion: 1,
    },
  }
}

describe('@sj/manifest — crypto', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const sodiumStub = {
    // Deterministic "random" bytes
    randombytes_buf: (len: number) => new Uint8Array(len).fill(7),

    // Symmetric AEAD stub:
    // - encrypt = prefix marker + plaintext (ignores aad/nonce/key, but deterministic)
    // - decrypt = validate marker then strip it
    crypto_aead_xchacha20poly1305_ietf_encrypt: (plaintext: Uint8Array) => {
      const marker = new TextEncoder().encode('STUB:')
      const out = new Uint8Array(marker.length + plaintext.length)
      out.set(marker, 0)
      out.set(plaintext, marker.length)
      return out
    },
    crypto_aead_xchacha20poly1305_ietf_decrypt: (_n: any, ciphertext: Uint8Array) => {
      const marker = new TextEncoder().encode('STUB:')
      const head = ciphertext.slice(0, marker.length)
      const ok =
        head.length === marker.length &&
        head.every((b, i) => b === marker[i])
      if (!ok) throw new Error('stub decrypt failed')
      return ciphertext.slice(marker.length)
    },
  }

  const cryptoDeps = {
    getSodium: async () => sodiumStub,
    randomBytes: (len: number) => sodiumStub.randombytes_buf(len),
  }

  it('roundtrip: deriveManifestKey -> encryptManifestV1 -> decryptManifestV1 returns original manifest', async () => {
    const kek = new Uint8Array(32).fill(9)
    const walletPubKey = 'wallet-pubkey'
    const manifestKey = await deriveManifestKey(kek)

    const manifest = makeManifest(walletPubKey, [
      {
        entryId: 'e1',
        fileCid: 'bafy-file-1',
        addedAt: '2026-01-01T00:00:00.000Z',
        originalFileName: 'hello.txt',
        mimeType: 'text/plain',
        fileSize: 123,
        envelope: makeEnvelope({ walletPubKey }),
        fileIntegritySha256B64: 'sha-b64-1',
      },
    ])

    const encrypted = await encryptManifestV1({
      manifest,
      manifestKey,
      walletPubKey,
      envelope: makeEncryptedManifestEnvelope(walletPubKey),
      deps: cryptoDeps,
    })

    const decrypted = await decryptManifestV1({
      encrypted,
      manifestKey,
      walletPubKey,
      deps: cryptoDeps,
    })

    expect(decrypted).toEqual(manifest)
  })

  it('integrity: sha256B64 equals computeManifestIntegritySha256B64(hashBasis) (Task 5 aligned rule)', async () => {
    const kek = new Uint8Array(32).fill(1)
    const walletPubKey = 'wallet-pubkey'
    const manifestKey = await deriveManifestKey(kek)

    const manifest = makeManifest(walletPubKey, [])

    const encrypted = await encryptManifestV1({
      manifest,
      manifestKey,
      walletPubKey,
      envelope: makeEncryptedManifestEnvelope(walletPubKey),
      deps: cryptoDeps,
    })

    const basis = {
      version: encrypted.version,
      kind: encrypted.kind,
      header: encrypted.header,
      payload: encrypted.payload,
      envelope: encrypted.envelope,
    }

    const expected = await computeManifestIntegritySha256B64(basis)
    expect(encrypted.integrity.sha256B64).toBe(expected)
  })

  it('tamper detection: modifying ciphertextB64 causes integrity mismatch', async () => {
    const kek = new Uint8Array(32).fill(2)
    const walletPubKey = 'wallet-pubkey'
    const manifestKey = await deriveManifestKey(kek)

    const manifest = makeManifest(walletPubKey, [])

    const encrypted = await encryptManifestV1({
      manifest,
      manifestKey,
      walletPubKey,
      envelope: makeEncryptedManifestEnvelope(walletPubKey),
      deps: cryptoDeps,
    })

    const tampered: EncryptedManifestObjectV1 = {
      ...encrypted,
      payload: {
        ...encrypted.payload,
        // minimal mutation that keeps base64-ish string but changes bytes
        ciphertextB64: encrypted.payload.ciphertextB64.slice(0, -2) + 'AA',
      },
    }

    await expect(
      decryptManifestV1({
        encrypted: tampered,
        manifestKey,
        walletPubKey,
        deps: cryptoDeps,
      })
    ).rejects.toThrow('integrity check failed')
  })

  it('tamper detection: modifying envelope (hash basis) causes integrity mismatch', async () => {
    const kek = new Uint8Array(32).fill(3)
    const walletPubKey = 'wallet-pubkey'
    const manifestKey = await deriveManifestKey(kek)

    const manifest = makeManifest(walletPubKey, [])

    const encrypted = await encryptManifestV1({
      manifest,
      manifestKey,
      walletPubKey,
      envelope: makeEncryptedManifestEnvelope(walletPubKey),
      deps: cryptoDeps,
    })

    const tampered: EncryptedManifestObjectV1 = {
      ...encrypted,
      envelope: {
        ...encrypted.envelope,
        wrap: {
          ...encrypted.envelope.wrap,
          context: 'manifest-wrap-aad-v1-tampered',
        },
      },
    }

    await expect(
      decryptManifestV1({
        encrypted: tampered,
        manifestKey,
        walletPubKey,
        deps: cryptoDeps,
      })
    ).rejects.toThrow('integrity check failed')
  })
})

describe('@sj/manifest — service mutex append (MVP)', () => {
  it('mutex: two concurrent appends do not lose entries (simplified)', async () => {
    const walletPubKey = 'wallet-pubkey'
    const signatureBytes = new Uint8Array([1, 2, 3])

    // In-memory "storage pointer"
    let manifestCid: string | null = 'cid-0'

    // In-memory "IPFS"
    const ipfsStore = new Map<string, Uint8Array>()

    // Start manifest in store: must be parseable as an EncryptedManifestObjectV1 because the service
    // unwrap path may inspect `encrypted.envelope` before decrypting (even in tests when we stub unwrap).
    const initialManifest = makeManifest(walletPubKey, [])
    const initialEncrypted: EncryptedManifestObjectV1 = {
      version: 1,
      kind: 'SJ_MANIFEST',
      header: {
        cipher: 'XChaCha20-Poly1305',
        nonce: 'n',
        aad: {
          walletPubKey,
          manifestVersion: 1,
          context: 'manifest',
        },
      },
      payload: {
        ciphertextB64: 'c',
      },
      envelope: makeEncryptedManifestEnvelope(walletPubKey),
      integrity: {
        sha256B64: 'i',
      },
    }
    ipfsStore.set('cid-0', new TextEncoder().encode(JSON.stringify(initialEncrypted)))

    // We do NOT need real crypto for mutex behavior test; we stub encrypt/decrypt at the service deps layer.
    // The service should read->decrypt, append, encrypt, addBytes, then setManifestCid.
    const deps = {
      nowIso: () => '2026-01-01T00:00:00.000Z',
      uuid: (() => {
        let i = 0
        return () => `uuid-${++i}`
      })(),

      deriveManifestKey: async () => new Uint8Array(32).fill(7),

      // Unit-test hook: bypass envelope-based unwrap; we always return a fixed manifestKey.
      unwrapManifestKey: vi.fn(async () => new Uint8Array(32).fill(7)),

      // Unit-test hook: provide a dedicated sodium stub so the service does not try to import libsodium-wrappers
      // when it needs randombytes_buf() for salt generation / wrap.
      getSodium: vi.fn(async () => ({
        randombytes_buf: (len: number) => new Uint8Array(len).fill(7),
        crypto_aead_xchacha20poly1305_ietf_encrypt: (plaintext: Uint8Array) => {
          const marker = new TextEncoder().encode('WRAPSTUB:')
          const out = new Uint8Array(marker.length + plaintext.length)
          out.set(marker, 0)
          out.set(plaintext, marker.length)
          return out
        },
        crypto_aead_xchacha20poly1305_ietf_decrypt: (_n: any, ciphertext: Uint8Array) => {
          const marker = new TextEncoder().encode('WRAPSTUB:')
          const head = ciphertext.slice(0, marker.length)
          const ok =
            head.length === marker.length &&
            head.every((b, i) => b === marker[i])
          if (!ok) throw new Error('wrap stub decrypt failed')
          return ciphertext.slice(marker.length)
        },
      })),

      // Stub: on decrypt, always return the latest "logical manifest" we keep below.
      // We'll update it whenever encrypt happens.
      _logicalManifest: initialManifest as ManifestV1,

      decryptManifestV1: vi.fn(async () => {
        return deps._logicalManifest
      }),

      encryptManifestV1: vi.fn(async ({ manifest, walletPubKey: pk }: any) => {
        // Return a minimal shape; addBytes will store serialized bytes
        // Integrity correctness is not under test here; concurrency is.
        return {
          version: 1,
          kind: 'SJ_MANIFEST',
          header: { cipher: 'XChaCha20-Poly1305', nonce: 'n', aad: { walletPubKey: pk, manifestVersion: 1, context: 'manifest' } },
          payload: { ciphertextB64: 'c' },
          envelope: makeEncryptedManifestEnvelope(pk),
          integrity: { sha256B64: 'i' },
          // also update our logical manifest
          __manifest: manifest,
        } as any
      }),

      addBytes: vi.fn(async (bytes: Uint8Array) => {
        const cid = `cid-${ipfsStore.size}`
        ipfsStore.set(cid, bytes)
        return { cid }
      }),

      catBytes: vi.fn(async (cid: string) => {
        const bytes = ipfsStore.get(cid)
        if (!bytes) throw new Error('not found')
        return bytes
      }),

      getManifestCid: vi.fn((_pk: string) => manifestCid),
      setManifestCid: vi.fn((_pk: string, cid: string) => {
        manifestCid = cid
      }),
    } as any

    // Patch logical manifest update when encrypt called, based on returned object
    ;(deps.encryptManifestV1 as any).mockImplementation(async ({ manifest, walletPubKey: pk }: any) => {
      deps._logicalManifest = manifest
      return {
        version: 1,
        kind: 'SJ_MANIFEST',
        header: { cipher: 'XChaCha20-Poly1305', nonce: 'n', aad: { walletPubKey: pk, manifestVersion: 1, context: 'manifest' } },
        payload: { ciphertextB64: 'c' },
        envelope: makeEncryptedManifestEnvelope(pk),
        integrity: { sha256B64: 'i' },
      }
    })

    const entryBase: Omit<ManifestEntryV1, 'addedAt' | 'entryId'> = {
      fileCid: 'bafy-file-1',
      originalFileName: 'a.txt',
      mimeType: 'text/plain',
      fileSize: 1,
      envelope: makeEnvelope({ walletPubKey }),
      fileIntegritySha256B64: 'sha',
    }

    const p1 = appendEntryAndPersist({
      walletPubKey,
      signatureBytes,
      entry: { ...entryBase, fileCid: 'bafy-file-1' },
      deps,
      origin: 'http://localhost',
      vaultId: 'local-default',
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    })

    const p2 = appendEntryAndPersist({
      walletPubKey,
      signatureBytes,
      entry: { ...entryBase, fileCid: 'bafy-file-2' },
      deps,
      origin: 'http://localhost',
      vaultId: 'local-default',
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    })

    const [r1, r2] = await Promise.all([p1, p2])

    // Both results should reflect a manifest containing both entries (order not guaranteed).
    const finalManifest = (r2.manifest.entries.length >= r1.manifest.entries.length ? r2.manifest : r1.manifest)

    const cids = finalManifest.entries.map((e) => e.fileCid).sort()
    expect(cids).toEqual(['bafy-file-1', 'bafy-file-2'])

    // Pointer must have been updated to the last uploaded CID
    expect(deps.setManifestCid).toHaveBeenCalled()
    expect(manifestCid).toMatch(/^cid-\d+$/)
  })
})
