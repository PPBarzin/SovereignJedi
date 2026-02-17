import canonicalize from 'canonicalize'
import { deriveKeyHKDF, sha256, utf8Encode } from '@sj/crypto'
import type { EncryptedManifestObjectV1, EncryptedManifestObjectV1HashBasis, ManifestV1 } from './types'

export type ManifestCryptoDeps = {
  /**
   * libsodium instance provider (for XChaCha20-Poly1305).
   * Inject in unit tests to avoid hard runtime dependency.
   */
  getSodium?: () => Promise<any>

  /**
   * RNG provider used for nonces (24 bytes). Defaults to libsodium.randombytes_buf(24).
   */
  randomBytes?: (len: number) => Uint8Array
}

/**
 * Manifest crypto (Task 6)
 *
 * HARD REQUIREMENTS (guardrails):
 * - Reuse the same primitives and conventions as Task 5:
 *   - canonicalize RFC8785 via `canonicalize` package (same as @sj/crypto v0_local_encryption)
 *   - sha256 via `@sj/crypto.sha256`
 *   - integrity hashing MUST use JSON.stringify(hashBasis) (NOT canonicalize), excluding `integrity`
 *   - base64 encoding compatible with existing code paths (browser + Node)
 * - No new crypto stack.
 * - Use XChaCha20-Poly1305 via libsodium-wrappers (same approach as localEncryption.ts).
 *
 * This module:
 * - derives a per-wallet ManifestKey from the KEK using HKDF-SHA256 with info="SJ-MANIFEST-v1"
 * - encrypts/decrypts the cleartext ManifestV1 using XChaCha20-Poly1305
 * - computes integrity.sha256B64 on the "hash basis" (object without integrity), aligned with Task 5
 */

/* -------------------------
 * Constants
 * ------------------------- */

const MANIFEST_KEY_INFO = utf8Encode('SJ-MANIFEST-v1')
const MANIFEST_KEY_LENGTH = 32 // bytes (XChaCha20 key length)
const MANIFEST_KIND = 'SJ_MANIFEST' as const

/* -------------------------
 * Helpers: base64 (aligned style with existing code)
 * ------------------------- */

function toBase64(bytes: Uint8Array): string {
  // Browser-friendly
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const str = Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join('')
    return window.btoa(str)
  }

  // Node fallback
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  throw new Error('No base64 encoder available')
}

function fromBase64(s: string): Uint8Array {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    const bin = window.atob(s)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return arr
  }

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(s, 'base64'))
  }

  throw new Error('No base64 decoder available')
}

/* -------------------------
 * Helpers: JSON serialization and integrity (Task 5 aligned)
 * ------------------------- */

function serializeToBytesJsonStringify(input: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input))
}

export async function computeManifestIntegritySha256B64(
  basis: EncryptedManifestObjectV1HashBasis
): Promise<string> {
  // Task 5 alignment: SHA-256 over TextEncoder(JSON.stringify(hashBasis))
  const basisBytes = serializeToBytesJsonStringify(basis)
  const hash = await sha256(basisBytes)
  return toBase64(new Uint8Array(hash))
}

/* -------------------------
 * Canonicalization helper (for AEAD AAD, aligned with Task 4/5)
 * ------------------------- */

function canonicalizeJSON(obj: object): string {
  const result = canonicalize(obj)
  if (typeof result !== 'string') {
    throw new Error('Canonicalization failed: canonicalize() did not return a string')
  }
  return result
}

/* -------------------------
 * libsodium resolution (same behavior as @sj/crypto v0_local_encryption)
 * ------------------------- */

async function getSodiumDefault(): Promise<any> {
  if (typeof (globalThis as any).sodium !== 'undefined') {
    const g = (globalThis as any).sodium
    if (g && g.ready) {
      await g.ready
    }
    return g
  }

  try {
    const mod = await import('libsodium-wrappers')
    const sodium = mod && (mod as any).default ? (mod as any).default : mod
    if (sodium && sodium.ready) {
      await sodium.ready
    }
    return sodium
  } catch (err: any) {
    const message = err?.message ?? String(err)
    throw new Error(
      'libsodium-wrappers is required but could not be loaded. Install and ensure the runtime can resolve "libsodium-wrappers". Original error: ' +
        message
    )
  }
}

function randomBytesDefault(len: number): Uint8Array {
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.getRandomValues) {
    const arr = new Uint8Array(len)
    ;(globalThis as any).crypto.getRandomValues(arr)
    return arr
  }
  throw new Error('No secure random source available for randomBytes')
}

async function resolveSodium(deps?: ManifestCryptoDeps): Promise<any> {
  const getter = deps?.getSodium ?? getSodiumDefault
  return getter()
}

function resolveRandomBytes(deps?: ManifestCryptoDeps): (len: number) => Uint8Array {
  return deps?.randomBytes ?? randomBytesDefault
}

/* -------------------------
 * Public API
 * ------------------------- */

/**
 * deriveManifestKey
 *
 * ManifestKey = HKDF-SHA256(KEK, salt=null, info="SJ-MANIFEST-v1", length=32)
 *
 * NOTE:
 * - This function reuses @sj/crypto.deriveKeyHKDF for HKDF-SHA256.
 * - Salt is intentionally null here to match the spec decision T06-D002.
 */
export async function deriveManifestKey(kek: Uint8Array): Promise<Uint8Array> {
  if (!(kek instanceof Uint8Array)) {
    kek = new Uint8Array(kek as any)
  }
  if (kek.byteLength === 0) {
    throw new Error('deriveManifestKey: kek must be a non-empty Uint8Array')
  }

  const okm = await deriveKeyHKDF(kek, null, MANIFEST_KEY_INFO, MANIFEST_KEY_LENGTH)
  return new Uint8Array(okm)
}

/**
 * encryptManifestV1
 *
 * Encrypts the cleartext manifest using XChaCha20-Poly1305 with:
 * - nonce: 24 random bytes (libsodium randombytes_buf)
 * - aad: canonicalized JSON of { walletPubKey, manifestVersion:1, context:"manifest" }
 *
 * Returns an EncryptedManifestObjectV1 with integrity.sha256B64 computed on the hash basis
 * (object without integrity), using JSON.stringify (Task 5 rule).
 */
export async function encryptManifestV1(params: {
  manifest: ManifestV1
  manifestKey: Uint8Array
  walletPubKey: string
  envelope: EncryptedManifestObjectV1['envelope']
  deps?: ManifestCryptoDeps
}): Promise<EncryptedManifestObjectV1> {
  const { manifest, manifestKey, walletPubKey, envelope } = params

  if (!walletPubKey || String(walletPubKey).trim().length === 0) {
    throw new Error('encryptManifestV1: walletPubKey must be a non-empty string')
  }
  if (!(manifestKey instanceof Uint8Array)) {
    throw new Error('encryptManifestV1: manifestKey must be a Uint8Array')
  }
  if (manifestKey.byteLength !== MANIFEST_KEY_LENGTH) {
    throw new Error(`encryptManifestV1: manifestKey must be ${MANIFEST_KEY_LENGTH} bytes`)
  }
  if (!manifest || manifest.version !== 1) {
    throw new Error('encryptManifestV1: manifest must be a ManifestV1 (version: 1)')
  }
  if (manifest.walletPubKey !== walletPubKey) {
    throw new Error('encryptManifestV1: manifest.walletPubKey must match walletPubKey')
  }

  if (!envelope || envelope.version !== 1) {
    throw new Error('encryptManifestV1: envelope must be present (version: 1)')
  }
  if (envelope.walletPubKey !== walletPubKey) {
    throw new Error('encryptManifestV1: envelope.walletPubKey must match walletPubKey')
  }

  const sodium = await resolveSodium(params.deps)
  if (!sodium) {
    throw new Error(
      'XChaCha20-Poly1305 encryption requires libsodium-wrappers. Ensure it is installed and available to the runtime.'
    )
  }

  const aadObj = {
    walletPubKey,
    manifestVersion: 1 as const,
    context: 'manifest' as const,
  }

  const rng = resolveRandomBytes(params.deps)
  const nonce = rng(24)
  const aadBytes = utf8Encode(canonicalizeJSON(aadObj))
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(manifest))

  const cipherBytes: Uint8Array = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    aadBytes,
    null,
    nonce,
    manifestKey
  )

  const basis: EncryptedManifestObjectV1HashBasis = {
    version: 1,
    kind: MANIFEST_KIND,
    header: {
      cipher: 'XChaCha20-Poly1305',
      nonce: toBase64(new Uint8Array(nonce)),
      aad: aadObj,
    },
    payload: {
      ciphertextB64: toBase64(new Uint8Array(cipherBytes)),
    },
    envelope,
  }

  const sha256B64 = await computeManifestIntegritySha256B64(basis)

  return {
    ...basis,
    integrity: {
      sha256B64,
    },
  }
}



/**
 * decryptManifestV1
 *
 * Verifies:
 * - encrypted.kind/version
 * - encrypted.header.aad matches walletPubKey/context
 * - integrity.sha256B64 matches recomputed hash over hash basis (Task 5 rule)
 *
 * Then decrypts payload using XChaCha20-Poly1305 and returns ManifestV1.
 */
export async function decryptManifestV1(params: {
  encrypted: EncryptedManifestObjectV1
  manifestKey: Uint8Array
  walletPubKey: string
  deps?: ManifestCryptoDeps
}): Promise<ManifestV1> {
  const { encrypted, manifestKey, walletPubKey } = params

  if (!encrypted || encrypted.version !== 1 || encrypted.kind !== MANIFEST_KIND) {
    throw new Error('decryptManifestV1: invalid encrypted manifest object (expected version: 1, kind: SJ_MANIFEST)')
  }

  if (!walletPubKey || String(walletPubKey).trim().length === 0) {
    throw new Error('decryptManifestV1: walletPubKey must be a non-empty string')
  }

  if (!(manifestKey instanceof Uint8Array)) {
    throw new Error('decryptManifestV1: manifestKey must be a Uint8Array')
  }
  if (manifestKey.byteLength !== MANIFEST_KEY_LENGTH) {
    throw new Error(`decryptManifestV1: manifestKey must be ${MANIFEST_KEY_LENGTH} bytes`)
  }

  const aad = encrypted.header?.aad
  if (
    !aad ||
    aad.context !== 'manifest' ||
    aad.manifestVersion !== 1 ||
    aad.walletPubKey !== walletPubKey
  ) {
    throw new Error('decryptManifestV1: AAD mismatch (walletPubKey/context/version)')
  }

  // Integrity verification (Task 5 aligned: JSON.stringify on basis excluding integrity)
  const basis: EncryptedManifestObjectV1HashBasis = {
    version: encrypted.version,
    kind: encrypted.kind,
    header: encrypted.header,
    payload: encrypted.payload,
    envelope: encrypted.envelope,
  }
  const expected = await computeManifestIntegritySha256B64(basis)
  const got = encrypted.integrity?.sha256B64
  if (!got || String(got) !== String(expected)) {
    throw new Error('decryptManifestV1: integrity check failed (sha256 mismatch)')
  }

  const sodium = await resolveSodium(params.deps)
  if (!sodium) {
    throw new Error(
      'XChaCha20-Poly1305 decryption requires libsodium-wrappers. Ensure it is installed and available to the runtime.'
    )
  }

  const nonce = fromBase64(encrypted.header.nonce)
  const ciphertext = fromBase64(encrypted.payload.ciphertextB64)
  const aadBytes = utf8Encode(canonicalizeJSON(aad))

  let plaintext: Uint8Array
  try {
    plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aadBytes,
      nonce,
      manifestKey
    ) as Uint8Array
  } catch (e: any) {
    throw new Error(`decryptManifestV1: decrypt failed: ${e?.message ?? String(e)}`)
  }

  const json = new TextDecoder().decode(plaintext)
  let parsed: any
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('decryptManifestV1: decrypted payload is not valid JSON')
  }

  if (!parsed || parsed.version !== 1) {
    throw new Error('decryptManifestV1: decrypted payload is not a ManifestV1 (version: 1)')
  }
  if (parsed.walletPubKey !== walletPubKey) {
    throw new Error('decryptManifestV1: decrypted manifest.walletPubKey mismatch')
  }

  return parsed as ManifestV1
}
