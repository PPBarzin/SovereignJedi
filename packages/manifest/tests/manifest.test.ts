import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { Envelope, BuildUnlockResult } from '@sj/crypto'
import type { EncryptedManifestObjectV1, ManifestEntryV1, ManifestV1 } from '../src/types'
import {
  deriveManifestKey,
  encryptManifestV1,
  decryptManifestV1,
  computeManifestIntegritySha256B64,
} from '../src/crypto'
import { appendEntryAndPersist, loadManifestOrInit } from '../src/service'

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

describe('@sj/manifest — loadManifestOrInit Restore Flow', () => {
  it('returns restore-required when local CID is missing but on-chain CID is provided', async () => {
    const walletPubKey = 'wallet-pubkey'
    const deps = {
      getManifestCid: vi.fn(() => null),
      setManifestCid: vi.fn(),
      addBytes: vi.fn(),
      nowIso: () => '2026-01-01T00:00:00.000Z',
    } as any

    const result = await loadManifestOrInit({
      walletPubKey,
      signatureBytes: new Uint8Array([1, 2, 3]),
      unlock: {
        canonicalObject: { expiresAt: '2099-01-01T00:00:00.000Z' } as any,
        messageToSign: 'SJ_UNLOCK_V1\n{}',
      },
      onChainLatestManifestCid: 'bafy-onchain-cid',
      deps,
    })

    expect(result.status).toBe('restore-required')
    expect(result.manifest).toBeNull()
    expect(result.manifestCid).toBeNull()
    expect(deps.setManifestCid).not.toHaveBeenCalled()
    expect(deps.addBytes).not.toHaveBeenCalled()
  })

  it('initializes empty manifest when both local and on-chain CID are missing', async () => {
    const walletPubKey = 'wallet-pubkey'
    const deps = {
      getManifestCid: vi.fn(() => null),
      setManifestCid: vi.fn(),
      addBytes: vi.fn(async () => ({ cid: 'bafy-new-cid' })),
      deriveManifestKey: async () => new Uint8Array(32).fill(7),
      encryptManifestV1: async () => ({
        version: 1,
        kind: 'SJ_MANIFEST',
        header: { cipher: 'XChaCha20-Poly1305', nonce: 'n', aad: { walletPubKey, manifestVersion: 1, context: 'manifest' } },
        payload: { ciphertextB64: 'c' },
        envelope: makeEncryptedManifestEnvelope(walletPubKey),
        integrity: { sha256B64: 'i' },
      } as any),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      getSodium: async () => ({
        randombytes_buf: (len: number) => new Uint8Array(len).fill(0),
        crypto_aead_xchacha20poly1305_ietf_encrypt: () => new Uint8Array(32),
      }),
    } as any

    const result = await loadManifestOrInit({
      walletPubKey,
      signatureBytes: new Uint8Array(64).fill(1), // dummy sig for SJ_VAULT_ROOT_V1
      unlock: {
        canonicalObject: { expiresAt: '2099-01-01T00:00:00.000Z' } as any,
        messageToSign: 'SJ_UNLOCK_V1\n{}',
      },
      onChainLatestManifestCid: null,
      deps,
    })

    expect(result.status).toBe('created')
    expect(result.manifest).toBeDefined()
    expect(result.manifestCid).toBe('bafy-new-cid')
    expect(deps.setManifestCid).toHaveBeenCalledWith(walletPubKey, 'bafy-new-cid')
  })
})

describe('@sj/manifest — service mutex append (MVP)', () => {
  it('unwrap fails with explicit legacy manifest error when messageTemplateId is SJ_UNLOCK_V1', async () => {
    const walletPubKey = 'wallet-pubkey'
    const goodUnlock: BuildUnlockResult = {
      canonicalObject: {} as any,
      messageToSign: 'SJ_UNLOCK_V1\n{"wallet":"wallet-pubkey"}',
    }
    const anySignatureBytes = new Uint8Array([9, 9, 9, 9])

    // Minimal encrypted manifest object; only envelope.kekDerivation.messageTemplateId is under test.
    // This represents a legacy manifest that used SJ_UNLOCK_V1 for KEK derivation, which is not
    // compatible with cross-refresh persistence.
    const encrypted: EncryptedManifestObjectV1 = {
      version: 1,
      kind: 'SJ_MANIFEST',
      header: {
        cipher: 'XChaCha20-Poly1305',
        nonce: 'nonce-b64',
        aad: { walletPubKey, manifestVersion: 1, context: 'manifest' },
      },
      payload: { ciphertextB64: 'cipher-b64' },
      envelope: {
        version: 1,
        walletPubKey,
        kekDerivation: {
          method: 'wallet-signature',
          messageTemplateId: 'SJ_UNLOCK_V1',
          salt: 'c2FsdA==', // "salt" (dummy)
          info: 'SJ-KEK-v1',
        },
        wrap: {
          cipher: 'XChaCha20-Poly1305',
          nonce: 'bm9uY2U=', // "nonce" (dummy)
          ciphertext: 'Y2lwaGVydGV4dA==', // "ciphertext" (dummy)
          context: 'manifest-wrap-aad-v1',
          aadVersion: 1,
        },
      },
      integrity: { sha256B64: 'i' },
    }

    // In-memory IPFS returns the encrypted object JSON.
    const catBytes = vi.fn(async () => new TextEncoder().encode(JSON.stringify(encrypted)))

    const deps = {
      catBytes,
      addBytes: vi.fn(async () => ({ cid: 'cid-new' })),
      getManifestCid: vi.fn(() => 'cid-0'),
      setManifestCid: vi.fn(),
      // decrypt should never be reached if legacy guard triggers
      decryptManifestV1: vi.fn(),
      deriveManifestKey: vi.fn(),
      encryptManifestV1: vi.fn(),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      uuid: () => 'uuid-1',
    } as any

    await expect(
      loadManifestOrInit({
        walletPubKey,
        signatureBytes: anySignatureBytes,
        unlock: goodUnlock,
        deps,
        origin: 'http://localhost',
        vaultId: 'local-default',
        nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
      })
    ).rejects.toThrow('Manifest legacy format detected (envelope messageTemplateId=SJ_UNLOCK_V1)')

    expect(deps.decryptManifestV1).not.toHaveBeenCalled()
    expect(deps.setManifestCid).not.toHaveBeenCalled()
  })

  it('mutex: two concurrent appends do not lose entries (simplified)', async () => {
    const walletPubKey = 'wallet-pubkey'
    const signatureBytes = new Uint8Array([1, 2, 3])
    const unlock: BuildUnlockResult = {
      canonicalObject: {
        expiresAt: '2099-01-01T00:00:00.000Z',
      } as any,
      messageToSign: 'SJ_UNLOCK_V1\n{}',
    }

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
      unlock,
      entry: { ...entryBase, fileCid: 'bafy-file-1' },
      onChainLatestManifestCid: null,
      deps,
      origin: 'http://localhost',
      vaultId: 'local-default',
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    })

    const p2 = appendEntryAndPersist({
      walletPubKey,
      signatureBytes,
      unlock,
      entry: { ...entryBase, fileCid: 'bafy-file-2' },
      onChainLatestManifestCid: null,
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

  it('appendEntryAndPersist throws Restore Required error when local CID is missing but on-chain CID is provided (Hardening)', async () => {
    const walletPubKey = 'wallet-pubkey'
    const signatureBytes = new Uint8Array([1, 2, 3])
    const unlock: BuildUnlockResult = {
      canonicalObject: { expiresAt: '2099-01-01T00:00:00.000Z' } as any,
      messageToSign: 'SJ_UNLOCK_V1\n{}',
    }

    const deps = {
      getManifestCid: vi.fn(() => null),
      setManifestCid: vi.fn(),
      addBytes: vi.fn(),
    } as any

    const entry: Omit<ManifestEntryV1, 'addedAt' | 'entryId'> = {
      fileCid: 'bafy-file-1',
      originalFileName: 'a.txt',
      mimeType: 'text/plain',
      fileSize: 1,
      envelope: makeEnvelope({ walletPubKey }),
    }

    await expect(
      appendEntryAndPersist({
        walletPubKey,
        signatureBytes,
        unlock,
        entry,
        onChainLatestManifestCid: 'bafy-onchain-cid',
        deps,
      })
    ).rejects.toThrow('Restore from Solana required before appending')

    expect(deps.setManifestCid).not.toHaveBeenCalled()
    expect(deps.addBytes).not.toHaveBeenCalled()
  })
})
