import { addBytes as ipfsAddBytes, catBytes as ipfsCatBytes } from '@sj/ipfs'
import { buildUnlockMessageV1, deriveKekFromUnlockSignature, sha256 } from '@sj/crypto'
import type { BuildUnlockResult } from '@sj/crypto'

import type {
  EncryptedManifestObjectV1,
  ManifestEntryV1,
  ManifestServiceDeps,
  ManifestV1,
} from './types'
import { getManifestCid as getManifestCidDefault, setManifestCid as setManifestCidDefault } from './storage'
import { createMutex } from './internal/mutex'
import { deriveManifestKey, decryptManifestV1, encryptManifestV1 as encryptManifestV1Crypto } from './crypto'

type UnwrapManifestKeyFn = (params: {
  encrypted: EncryptedManifestObjectV1
  walletPubKey: string
  signatureBytes: Uint8Array
  nowMs: number
  origin: string
  vaultId: string
}) => Promise<Uint8Array>

/**
 * Manifest service (Task 6)
 *
 * Responsibilities:
 * - Load manifest via local pointer (CID) and IPFS catBytes, decrypt and verify integrity.
 * - Initialize a new empty manifest when no pointer exists, encrypt + upload to IPFS, and store pointer.
 * - Append entries with MVP concurrency control:
 *    mutex (in-tab) + strategy read → merge → write
 *
 * Guardrails:
 * - No multi-tab locking (MVP).
 * - On error (IPFS KO, decrypt KO, integrity KO): throw error, do NOT modify local pointer, do NOT upload new manifest.
 * - Never regenerate/overwrite a manifest automatically on load errors.
 *
 * Crypto alignment:
 * - derive ManifestKey via HKDF from KEK (see crypto.ts).
 * - encryption/decryption uses XChaCha20-Poly1305 libsodium.
 * - integrity uses SHA-256 over JSON.stringify(hashBasis) bytes (same as Task 5).
 */

/* -------------------------
 * Minimal utils (no secret logs)
 * ------------------------- */

function nowIsoDefault(): string {
  return new Date().toISOString()
}

function uuidDefault(): string {
  // Prefer Web Crypto UUID if available
  const g: any = typeof globalThis !== 'undefined' ? globalThis : {}
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID()

  // Fallback: not cryptographically strong, but acceptable for MVP entryId uniqueness.
  // We keep it deterministic-ish and collision-resistant enough for local usage.
  return `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function encodeJsonToBytes(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj))
}

function decodeBytesToJson(bytes: Uint8Array): any {
  const json = new TextDecoder().decode(bytes)
  return JSON.parse(json)
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  // browser fallback
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b == null) {
      throw new Error('toBase64: unexpected undefined byte (noUncheckedIndexedAccess)')
    }
    binary += String.fromCharCode(b)
  }
  // eslint-disable-next-line no-undef
  return btoa(binary)
}

async function computeSha256B64OnStringifyBasis(basis: unknown): Promise<string> {
  // Task 5 alignment: sha256(TextEncoder().encode(JSON.stringify(basis))) then base64
  const hash = await sha256(encodeJsonToBytes(basis))
  return toBase64(new Uint8Array(hash))
}

/* -------------------------
 * Manifest key wrap (manifest envelope)
 * ------------------------- */

/**
 * This "manifest envelope" wraps the ManifestKey with the KEK using XChaCha20-Poly1305,
 * and carries the KEK derivation metadata needed to re-derive KEK.
 *
 * IMPORTANT:
 * - We must not introduce a new crypto stack.
 * - For the wrap itself we reuse libsodium via crypto.ts dependency (libsodium-wrappers).
 *
 * To avoid circular dependency leakage, we implement wrap/unwrap here with the same libsodium
 * resolver pattern as the crypto module uses.
 */
async function getSodium(): Promise<any> {
  if (typeof (globalThis as any).sodium !== 'undefined') {
    const g = (globalThis as any).sodium
    if (g && g.ready) await g.ready
    return g
  }
  try {
    const mod = await import('libsodium-wrappers')
    const sodium = mod && (mod as any).default ? (mod as any).default : mod
    if (sodium && sodium.ready) await sodium.ready
    return sodium
  } catch (err: any) {
    const message = err?.message ?? String(err)
    throw new Error(
      'libsodium-wrappers is required but could not be loaded (manifest service). Original error: ' + message
    )
  }
}

function resolveSodiumFromDeps(deps: any): Promise<any> | null {
  // Unit-test hook: allow tests to inject a sodium stub to avoid importing libsodium in Node/Vitest.
  // Production callers should not rely on this.
  if (deps && typeof deps.getSodium === 'function') {
    return deps.getSodium()
  }
  return null
}

function fromBase64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'))
  // eslint-disable-next-line no-undef
  const bin = atob(s)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function assertNonEmptyString(name: string, value: string): void {
  if (!value || String(value).trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

type UnlockLike = BuildUnlockResult

export type LoadManifestResult = {
  manifest: ManifestV1
  manifestCid: string
}

/**
 * Build the manifest "envelope" that wraps the ManifestKey with the KEK.
 *
 * Wrap AAD:
 * We bind the wrap to the wallet and a context string. This is not specified in Task 6 beyond
 * "context" + "aadVersion". We keep it explicit and stable.
 */
async function buildManifestWrapEnvelope(params: {
  walletPubKey: string
  kek: Uint8Array
  manifestKey: Uint8Array
  unlock: UnlockLike
  saltBytes: Uint8Array
  sodium?: any
}): Promise<EncryptedManifestObjectV1['envelope']> {
  const { walletPubKey, kek, manifestKey, unlock, saltBytes } = params

  assertNonEmptyString('buildManifestWrapEnvelope:walletPubKey', walletPubKey)
  if (!(kek instanceof Uint8Array) || kek.byteLength === 0) throw new Error('buildManifestWrapEnvelope: kek invalid')
  if (!(manifestKey instanceof Uint8Array) || manifestKey.byteLength !== 32) {
    throw new Error('buildManifestWrapEnvelope: manifestKey must be 32 bytes')
  }
  if (!(saltBytes instanceof Uint8Array) || saltBytes.byteLength === 0) {
    throw new Error('buildManifestWrapEnvelope: saltBytes invalid')
  }

  const sodium = params.sodium ?? (await getSodium())
  const wrapNonce = sodium.randombytes_buf(24) as Uint8Array

  // AAD binding for wrap: stable JSON string (not canonicalize here; wrap AAD for files uses canonicalize
  // inside @sj/crypto, but Task 6 only requires "context" and "aadVersion". We choose an explicit binding.)
  const aadVersion = 1
  const context = 'manifest-wrap-aad-v1'
  const wrapAadObj = {
    v: aadVersion,
    context,
    walletPubKey,
    messageTemplateId: unlock?.canonicalObject?.type ? 'SJ_UNLOCK_V1' : 'SJ_UNLOCK_V1',
  }
  const wrapAadBytes = encodeJsonToBytes(wrapAadObj)

  const wrapped: Uint8Array = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    manifestKey,
    wrapAadBytes,
    null,
    wrapNonce,
    kek
  )

  return {
    version: 1,
    walletPubKey,
    kekDerivation: {
      method: 'wallet-signature',
      messageTemplateId: 'SJ_UNLOCK_V1',
      salt: toBase64(saltBytes),
      info: 'SJ-KEK-v1',
    },
    wrap: {
      cipher: 'XChaCha20-Poly1305',
      nonce: toBase64(wrapNonce),
      ciphertext: toBase64(wrapped),
      context,
      aadVersion,
    },
  }
}

/**
 * Unwrap ManifestKey from an encrypted manifest object's envelope.
 */
async function unwrapManifestKey(params: {
  encrypted: EncryptedManifestObjectV1
  walletPubKey: string
  signatureBytes: Uint8Array
  nowMs: number
  origin: string
  vaultId: string
}): Promise<Uint8Array> {
  const { encrypted, walletPubKey, signatureBytes, nowMs, origin, vaultId } = params

  const env = encrypted.envelope
  if (!env || env.version !== 1) throw new Error('unwrapManifestKey: missing envelope')
  if (env.walletPubKey !== walletPubKey) throw new Error('unwrapManifestKey: walletPubKey mismatch')

  const saltBytes = fromBase64(env.kekDerivation?.salt ?? '')
  if (!(saltBytes instanceof Uint8Array) || saltBytes.byteLength === 0) {
    throw new Error('unwrapManifestKey: invalid envelope.kekDerivation.salt')
  }

  // Rebuild unlock message to re-derive KEK (OQ-06 enforced by deriveKekFromUnlockSignature).
  const issuedAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString()

  const unlock = await buildUnlockMessageV1({
    origin,
    wallet: walletPubKey,
    vaultId,
    issuedAt,
    expiresAt,
  })

  const kek = await deriveKekFromUnlockSignature({
    signatureBytes,
    saltBytes,
    unlock,
    nowMs,
  })

  const sodium = await getSodium()
  const wrap = env.wrap
  if (!wrap) throw new Error('unwrapManifestKey: missing envelope.wrap')

  const wrapNonce = fromBase64(wrap.nonce)
  const wrappedCipher = fromBase64(wrap.ciphertext)

  const aadVersion = wrap.aadVersion ?? 1
  const context = wrap.context ?? 'manifest-wrap-aad-v1'
  const wrapAadObj = {
    v: aadVersion,
    context,
    walletPubKey,
    messageTemplateId: env.kekDerivation?.messageTemplateId ?? 'SJ_UNLOCK_V1',
  }
  const wrapAadBytes = encodeJsonToBytes(wrapAadObj)

  let manifestKey: Uint8Array
  try {
    manifestKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      wrappedCipher,
      wrapAadBytes,
      wrapNonce,
      kek
    ) as Uint8Array
  } catch (e: any) {
    throw new Error(`unwrapManifestKey: unwrap failed: ${e?.message ?? String(e)}`)
  }

  if (!(manifestKey instanceof Uint8Array) || manifestKey.byteLength !== 32) {
    throw new Error('unwrapManifestKey: invalid unwrapped manifestKey length')
  }

  return manifestKey
}

async function resolveManifestKey(params: {
  encrypted: EncryptedManifestObjectV1
  walletPubKey: string
  signatureBytes: Uint8Array
  nowMs: number
  origin: string
  vaultId: string
  unwrap?: UnwrapManifestKeyFn
}): Promise<Uint8Array> {
  // Unit-test hook: allow caller to bypass the unwrap path entirely by injecting a resolver.
  // Guardrail: production callers should rely on the default unwrap implementation.
  const unwrap = params.unwrap ?? unwrapManifestKey
  return unwrap({
    encrypted: params.encrypted,
    walletPubKey: params.walletPubKey,
    signatureBytes: params.signatureBytes,
    nowMs: params.nowMs,
    origin: params.origin,
    vaultId: params.vaultId,
  })
}

/* -------------------------
 * Default deps
 * ------------------------- */

const mutexByWallet = new Map<string, ReturnType<typeof createMutex>>()

function getMutex(walletPubKey: string) {
  let m = mutexByWallet.get(walletPubKey)
  if (!m) {
    m = createMutex()
    mutexByWallet.set(walletPubKey, m)
  }
  return m
}

const defaultDeps: ManifestServiceDeps = {
  nowIso: nowIsoDefault,
  uuid: uuidDefault,

  deriveManifestKey: async (kek) => deriveManifestKey(kek),

  encryptManifestV1: async ({ manifest, manifestKey, walletPubKey }: any) => {
    throw new Error(
      'encryptManifestV1 is service-dependent because it requires the service-built wrap envelope. ' +
        'Callers must provide an injected deps.encryptManifestV1 or use the service internal default wrapper at call-site.'
    )
  },

  decryptManifestV1: async ({ encrypted, manifestKey, walletPubKey }) =>
    decryptManifestV1({ encrypted, manifestKey, walletPubKey }),

  addBytes: async (bytes) => {
    const res = await ipfsAddBytes(bytes)
    return { cid: res.cid }
  },
  catBytes: async (cid) => ipfsCatBytes(cid),

  getManifestCid: (walletPubKey) => getManifestCidDefault(walletPubKey),
  setManifestCid: (walletPubKey, cid) => setManifestCidDefault(walletPubKey, cid),
}

/* -------------------------
 * Public service API
 * ------------------------- */

/**
 * loadManifestOrInit
 *
 * Bootstrap flow:
 * - Read local pointer (manifestCid) for walletPubKey
 * - If absent: create empty manifest, encrypt, upload, store pointer
 * - If present: fetch bytes from IPFS, parse JSON, verify integrity, unwrap ManifestKey, decrypt manifest
 *
 * Inputs:
 * - walletPubKey: base58 string (identity)
 * - signatureBytes: current proof-of-control signature bytes (from unlocked identity)
 *
 * NOTE:
 * - We intentionally do NOT perform any UI gating here; app layer enforces Verified/Unlocked.
 * - We do NOT persist any keys; only CID pointer is persisted.
 */
export async function loadManifestOrInit(params: {
  walletPubKey: string
  signatureBytes: Uint8Array
  deps?: Partial<ManifestServiceDeps>
  origin?: string
  vaultId?: string
  nowMs?: number
}): Promise<LoadManifestResult> {
  const walletPubKey = String(params.walletPubKey ?? '').trim()
  assertNonEmptyString('loadManifestOrInit:walletPubKey', walletPubKey)

  const deps: ManifestServiceDeps = { ...defaultDeps, ...(params.deps ?? {}) } as any
  const origin = params.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  const vaultId = params.vaultId ?? 'local-default'
  const nowMs = params.nowMs ?? Date.now()

  const existingCid = deps.getManifestCid(walletPubKey)

  if (!existingCid) {
    // INIT: create empty manifest, derive KEK and ManifestKey, wrap it, encrypt manifest, upload, store pointer.
    const createdAt = deps.nowIso()
    const manifest: ManifestV1 = {
      version: 1,
      walletPubKey,
      createdAt,
      updatedAt: createdAt,
      entries: [],
    }

    // Derive KEK (must go through unlock + deriveKekFromUnlockSignature for OQ-06)
    const saltBytes = (await getSodium()).randombytes_buf(32) as Uint8Array
    const issuedAt = new Date(nowMs).toISOString()
    const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString()

    const unlock = await buildUnlockMessageV1({
      origin,
      wallet: walletPubKey,
      vaultId,
      issuedAt,
      expiresAt,
    })

    const kek = await deriveKekFromUnlockSignature({
      signatureBytes: params.signatureBytes,
      saltBytes,
      unlock,
      nowMs,
    })

    const manifestKey = await deps.deriveManifestKey(kek)
    const injectedSodium = await resolveSodiumFromDeps(deps)
    const envelope = await buildManifestWrapEnvelope({
      walletPubKey,
      kek,
      manifestKey,
      unlock,
      saltBytes,
      sodium: injectedSodium ?? undefined,
    })

    const encryptWithDefault = deps.encryptManifestV1 ?? (async ({ manifest, manifestKey, walletPubKey }: any) => {
      // Default path: use crypto implementation directly.
      // The service constructs the required envelope and passes it through.
      return encryptManifestV1Crypto({
        manifest,
        manifestKey,
        walletPubKey,
        envelope,
      } as any)
    })

    const encrypted = await encryptWithDefault({
      manifest,
      manifestKey,
      walletPubKey,
    } as any)

    const bytes = encodeJsonToBytes(encrypted)
    const { cid } = await deps.addBytes(bytes)

    deps.setManifestCid(walletPubKey, cid)

    return { manifest, manifestCid: cid }
  }

  // LOAD: fetch encrypted object from IPFS, verify integrity, unwrap manifestKey, decrypt.
  const bytes = await deps.catBytes(existingCid)
  let encryptedObj: EncryptedManifestObjectV1
  try {
    encryptedObj = decodeBytesToJson(bytes) as EncryptedManifestObjectV1
  } catch (e: any) {
    throw new Error(`Impossible de charger le manifest : JSON invalide (CID=${existingCid})`)
  }

  // Integrity verification is done inside decryptManifestV1, but requires manifestKey.
  // So we unwrap manifestKey first, then decrypt.
  const manifestKey = await resolveManifestKey({
    encrypted: encryptedObj,
    walletPubKey,
    signatureBytes: params.signatureBytes,
    nowMs,
    origin,
    vaultId,
    unwrap: (deps as any).unwrapManifestKey,
  })

  const manifest = await deps.decryptManifestV1({
    encrypted: encryptedObj,
    manifestKey,
    walletPubKey,
  })

  return { manifest, manifestCid: existingCid }
}

/**
 * appendEntryAndPersist
 *
 * MVP concurrency:
 * - in-tab mutex per wallet
 * - read → merge → write:
 *    1) load manifest from current pointer
 *    2) append entry (dedupe by entryId/fileCid)
 *    3) encrypt + upload new manifest -> new CID
 *    4) set pointer to new CID (only after successful upload)
 *
 * Error handling (guardrail):
 * - On any error: throw; do not change pointer; do not upload partials.
 * - No silent regeneration/reset.
 */
export async function appendEntryAndPersist(params: {
  walletPubKey: string
  signatureBytes: Uint8Array
  entry: Omit<ManifestEntryV1, 'addedAt' | 'entryId'> & Partial<Pick<ManifestEntryV1, 'addedAt' | 'entryId'>>
  deps?: Partial<ManifestServiceDeps>
  origin?: string
  vaultId?: string
  nowMs?: number
}): Promise<{ manifest: ManifestV1; manifestCid: string }> {
  const walletPubKey = String(params.walletPubKey ?? '').trim()
  assertNonEmptyString('appendEntryAndPersist:walletPubKey', walletPubKey)

  const deps: ManifestServiceDeps = { ...defaultDeps, ...(params.deps ?? {}) } as any
  const origin = params.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  const vaultId = params.vaultId ?? 'local-default'
  const nowMs = params.nowMs ?? Date.now()

  const mutex = getMutex(walletPubKey)

  return mutex.runExclusive(async () => {
    const currentCid = deps.getManifestCid(walletPubKey)
    if (!currentCid) {
      // No pointer: we must init first (do not append blindly).
      const init = await loadManifestOrInit({
        walletPubKey,
        signatureBytes: params.signatureBytes,
        deps,
        origin,
        vaultId,
        nowMs,
      })
      // After init, recursively append within same mutex by continuing.
      // currentCid should now exist.
    }

    const cid = deps.getManifestCid(walletPubKey)
    if (!cid) {
      throw new Error('Impossible de mettre à jour le manifest : pointeur CID absent après init.')
    }

    // Read current encrypted manifest
    const raw = await deps.catBytes(cid)
    let encryptedObj: EncryptedManifestObjectV1
    try {
      encryptedObj = decodeBytesToJson(raw) as EncryptedManifestObjectV1
    } catch {
      throw new Error('Impossible de charger le manifest : JSON invalide.')
    }

    // Unwrap manifest key
    const manifestKey = await resolveManifestKey({
      encrypted: encryptedObj,
      walletPubKey,
      signatureBytes: params.signatureBytes,
      nowMs,
      origin,
      vaultId,
      unwrap: (deps as any).unwrapManifestKey,
    })

    // Decrypt (includes integrity verification)
    const manifest = await deps.decryptManifestV1({
      encrypted: encryptedObj,
      manifestKey,
      walletPubKey,
    })

    // Merge/append
    const addedAt = params.entry.addedAt ?? deps.nowIso()
    const entryId = params.entry.entryId ?? deps.uuid()

    const newEntryBase = {
      entryId,
      fileCid: params.entry.fileCid,
      addedAt,
      envelope: params.entry.envelope,
    } as const

    // IMPORTANT (exactOptionalPropertyTypes):
    // Only include optional fields when they are actually defined.
    const newEntry: ManifestEntryV1 = {
      ...newEntryBase,
      ...(params.entry.originalFileName !== undefined ? { originalFileName: params.entry.originalFileName } : {}),
      ...(params.entry.mimeType !== undefined ? { mimeType: params.entry.mimeType } : {}),
      ...(params.entry.fileSize !== undefined ? { fileSize: params.entry.fileSize } : {}),
      ...(params.entry.fileIntegritySha256B64 !== undefined
        ? { fileIntegritySha256B64: params.entry.fileIntegritySha256B64 }
        : {}),
    }

    if (!newEntry.fileCid || String(newEntry.fileCid).trim().length === 0) {
      throw new Error('appendEntryAndPersist: entry.fileCid must be a non-empty string')
    }
    if (!newEntry.envelope) {
      throw new Error('appendEntryAndPersist: entry.envelope is required')
    }

    const exists = manifest.entries.some(
      (e) => e.entryId === newEntry.entryId || (e.fileCid === newEntry.fileCid && e.addedAt === newEntry.addedAt)
    )
    if (!exists) {
      manifest.entries = [...manifest.entries, newEntry]
    }

    manifest.updatedAt = deps.nowIso()

    // Re-wrap manifest key with a fresh salt per manifest update (keeps KEK derivation bound to current proof).
    // NOTE: We keep method wallet-signature + SJ_UNLOCK_V1; salt stored in envelope.
    const injectedSodium = await resolveSodiumFromDeps(deps)
    const sodium = injectedSodium ?? (await getSodium())
    const saltBytes = sodium.randombytes_buf(32) as Uint8Array

    const issuedAt = new Date(nowMs).toISOString()
    const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString()

    const unlock = await buildUnlockMessageV1({
      origin,
      wallet: walletPubKey,
      vaultId,
      issuedAt,
      expiresAt,
    })

    const kek = await deriveKekFromUnlockSignature({
      signatureBytes: params.signatureBytes,
      saltBytes,
      unlock,
      nowMs,
    })

    const envelope = await buildManifestWrapEnvelope({
      walletPubKey,
      kek,
      manifestKey,
      unlock,
      saltBytes,
      sodium: injectedSodium ?? undefined,
    })

    // Encrypt new manifest object (integrity computed inside)
    const encryptWithDefault = deps.encryptManifestV1 ?? (async ({ manifest, manifestKey, walletPubKey }: any) => {
      return encryptManifestV1Crypto({
        manifest,
        manifestKey,
        walletPubKey,
        envelope,
      } as any)
    })

    const newEncrypted = await encryptWithDefault({
      manifest,
      manifestKey,
      walletPubKey,
    } as any)

    // Upload new manifest bytes
    const newBytes = encodeJsonToBytes(newEncrypted)
    const { cid: newCid } = await deps.addBytes(newBytes)

    // Update pointer only after successful upload
    deps.setManifestCid(walletPubKey, newCid)

    return { manifest, manifestCid: newCid }
  })
}

/**
 * Test helper: compute integrity hash basis (Task 5 aligned) for a manifest encrypted object.
 * This is not exported from index.ts; tests can import from this file if needed.
 */
export async function _computeEncryptedManifestIntegrityForTests(
  encrypted: EncryptedManifestObjectV1
): Promise<string> {
  const basis = {
    version: encrypted.version,
    kind: encrypted.kind,
    header: encrypted.header,
    payload: encrypted.payload,
    envelope: encrypted.envelope,
  }
  return computeSha256B64OnStringifyBasis(basis)
}
