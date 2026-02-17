/**
 * @package @sj/ipfs
 * Sovereign Jedi — Task 5 (IPFS integration, files)
 *
 * Public entrypoint.
 *
 * This package provides a minimal abstraction layer over Helia (in-browser IPFS)
 * so the UI never calls Helia directly.
 *
 * Invariants (spec):
 * - No plaintext leaves the device (this module MUST only handle encrypted bytes/objects).
 * - Upload gating (IdentityVerified && VaultUnlocked) is enforced by the app layer (apps/web),
 *   not inside this package.
 * - No secret persistence (fileKey/KEK/plaintext).
 * - CID must cover the entire uploaded encrypted object bytes.
 * - Local SHA-256 integrity hash is computed by the caller/orchestrator and injected into the object.
 *
 * Connectivity (MVP):
 * - Deterministic dev connectivity via local libp2p node over WebSockets.
 * - Config is provided via NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS (CSV). Absence MUST throw.
 */

export type {
  EnvelopeLike,
  Header,
  EncryptedIpfsPayloadV1,
  EncryptedIpfsIntegrityV1,
  EncryptedIpfsObjectV1,
  EncryptedIpfsObjectV1HashBasis,
  AddBytesResult,
  AddEncryptedPackageResult,
  IpfsClientConfig,
} from './types'

export {
  getIpfsContext,
  addBytes,
  catBytes,
  addEncryptedPackage,
  resetIpfsContextForTests,
} from './client'
