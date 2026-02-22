import type { ManifestStorage } from './types.js'

/**
 * Manifest CID pointer storage (MVP)
 *
 * Stores the latest manifest CID locally, keyed by wallet pubkey:
 *   key   = sj:manifestCid:<walletPubKey>
 *   value = <cid string>
 *
 * Invariants:
 * - No secrets are stored here (CID only).
 * - This is per-device/per-browser-state (non cross-device).
 * - Wallet pubkey is not user input; it comes from the connected wallet adapter.
 */

const PREFIX = 'sj:manifestCid:'

function isDebugEnabled(): boolean {
  try {
    return String(process.env.NEXT_PUBLIC_SJ_DEBUG).toLowerCase() === 'true'
  } catch {
    return false
  }
}

function debugLog(message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  try {
    // eslint-disable-next-line no-console
    console.debug(`[SJ_DEBUG][manifest:storage] ${message}`, data ?? {})
  } catch {
    // ignore
  }
}

/**
 * Canonicalize wallet pubkey to a strict base58-ish normalized string.
 *
 * Goal (MVP):
 * - Ensure the storage key is stable and consistent across code paths.
 *
 * NOTE:
 * - We avoid heavy validation here (no dependency). The pubkey comes from wallet-adapter,
 *   so we enforce minimal canonicalization: trim + no whitespace.
 */
function canonicalizeWalletPubKey(walletPubKey: string): string {
  const pk = String(walletPubKey ?? '').trim()
  if (!pk) {
    throw new Error('canonicalizeWalletPubKey: walletPubKey must be a non-empty string')
  }
  if (/\s/.test(pk)) {
    throw new Error('canonicalizeWalletPubKey: walletPubKey must not contain whitespace')
  }
  return pk
}

export function buildManifestStorageKey(walletPubKey: string): string {
  const pk = canonicalizeWalletPubKey(walletPubKey)
  return `${PREFIX}${pk}`
}

function getDefaultStorageOrThrow(): ManifestStorage {
  // NOTE: localStorage is browser-only. For tests, pass an injected storage implementation.
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    throw new Error('Manifest pointer storage requires localStorage (browser environment)')
  }
  return window.localStorage
}

function assertCidLike(cid: string): void {
  const v = String(cid ?? '').trim()
  if (!v) {
    throw new Error('setManifestCid: cid must be a non-empty string')
  }
}

export function getManifestCid(walletPubKey: string, storage?: ManifestStorage): string | null {
  const s = storage ?? getDefaultStorageOrThrow()
  const pk = canonicalizeWalletPubKey(walletPubKey)
  const key = buildManifestStorageKey(pk)
  const raw = s.getItem(key)
  const cid = raw == null ? null : String(raw).trim()
  const cidFound = cid && cid.length > 0 ? cid : null

  debugLog('getManifestCid()', {
    walletPubKey: pk,
    storageKey: key,
    cidFound,
  })

  return cidFound
}

export function setManifestCid(walletPubKey: string, cid: string, storage?: ManifestStorage): void {
  assertCidLike(cid)
  const s = storage ?? getDefaultStorageOrThrow()
  const pk = canonicalizeWalletPubKey(walletPubKey)
  const key = buildManifestStorageKey(pk)
  const value = String(cid).trim()

  s.setItem(key, value)

  debugLog('setManifestCid()', {
    walletPubKey: pk,
    storageKey: key,
    cid: value,
  })
}

export function removeManifestCid(walletPubKey: string, storage?: ManifestStorage): void {
  const s = storage ?? getDefaultStorageOrThrow()
  const pk = canonicalizeWalletPubKey(walletPubKey)
  const key = buildManifestStorageKey(pk)

  if (typeof s.removeItem === 'function') {
    s.removeItem(key)
    debugLog('removeManifestCid()', { walletPubKey: pk, storageKey: key, removed: true })
    return
  }

  // Fallback: overwrite with empty; getManifestCid() treats empty as absent
  s.setItem(key, '')
  debugLog('removeManifestCid()', { walletPubKey: pk, storageKey: key, removed: true, fallback: 'overwrite-empty' })
}
