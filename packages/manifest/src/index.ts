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
 *
 * Node ESM compatibility:
 * - Internal relative imports use explicit `.js` extensions so emitted ESM can be resolved by Node.
 */

export type {
  ManifestV1,
  ManifestEntryV1,
  EncryptedManifestObjectV1,
  EncryptedManifestObjectV1HashBasis,
  ManifestStorage,
  ManifestServiceDeps,
} from './types.js'

export type { ManifestCryptoDeps } from './crypto.js'

export {
  getManifestCid,
  setManifestCid,
  removeManifestCid,
  buildManifestStorageKey,
} from './storage.js'

export {
  deriveManifestKey,
  encryptManifestV1,
  decryptManifestV1,
  computeManifestIntegritySha256B64,
} from './crypto.js'

export {
  loadManifestOrInit,
  appendEntryAndPersist,
} from './service.js'
