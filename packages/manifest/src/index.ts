/**
 * @package @sj/manifest
 * Sovereign Jedi — Task 6 (User data layer)
 *
 * Public entrypoint.
 *
 * This package implements the encrypted Manifest v1 used to list ("My files")
 * the encrypted IPFS objects a wallet can open.
 *
 * Notes / invariants:
 * - No plaintext leaves the device.
 * - No secret persistence (no KEK/file keys persisted).
 * - Envelope type is imported from @sj/crypto and is the source-of-truth (no alias export).
 */

export type {
  ManifestV1,
  ManifestEntryV1,
  EncryptedManifestObjectV1,
  EncryptedManifestObjectV1HashBasis,
  ManifestStorage,
  ManifestServiceDeps,
} from './types'

export type { ManifestCryptoDeps } from './crypto'

export {
  getManifestCid,
  setManifestCid,
  removeManifestCid,
  buildManifestStorageKey,
} from './storage'

export {
  deriveManifestKey,
  encryptManifestV1,
  decryptManifestV1,
  computeManifestIntegritySha256B64,
} from './crypto'

export {
  loadManifestOrInit,
  appendEntryAndPersist,
} from './service'
