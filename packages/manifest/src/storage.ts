import type { ManifestStorage } from './types'

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

export function buildManifestStorageKey(walletPubKey: string): string {
  const pk = String(walletPubKey ?? '').trim()
  if (!pk) {
    throw new Error('buildManifestStorageKey: walletPubKey must be a non-empty string')
  }
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
  const key = buildManifestStorageKey(walletPubKey)
  const raw = s.getItem(key)
  if (raw == null) return null
  const cid = String(raw).trim()
  return cid.length > 0 ? cid : null
}

export function setManifestCid(walletPubKey: string, cid: string, storage?: ManifestStorage): void {
  assertCidLike(cid)
  const s = storage ?? getDefaultStorageOrThrow()
  const key = buildManifestStorageKey(walletPubKey)
  s.setItem(key, String(cid).trim())
}

export function removeManifestCid(walletPubKey: string, storage?: ManifestStorage): void {
  const s = storage ?? getDefaultStorageOrThrow()
  const key = buildManifestStorageKey(walletPubKey)

  if (typeof s.removeItem === 'function') {
    s.removeItem(key)
    return
  }

  // Fallback: overwrite with empty; getManifestCid() treats empty as absent
  s.setItem(key, '')
}
