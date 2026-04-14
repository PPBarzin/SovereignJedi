import type { Envelope } from '@sj/crypto'

/**
 * Manifest v1 — cleartext (before encryption)
 *
 * This object is encrypted client-side and stored on IPFS.
 * The UI ("My files") must reflect `entries` from the decrypted manifest.
 */
export type ManifestV1 = {
  version: 1
  walletPubKey: string
  createdAt: string // ISO
  updatedAt: string // ISO
  entries: ManifestEntryV1[]
}

/**
 * A single file entry in the manifest.
 *
 * IMPORTANT:
 * - `envelope` is the source-of-truth type imported from @sj/crypto (do not alias-export it).
 * - Metadata fields are optional; they are protected by manifest encryption.
 */
export type ManifestEntryV1 = {
  entryId: string // uuid v4 or hash
  fileCid: string // CID of the encrypted IPFS package (Task 5)
  addedAt: string // ISO

  // Optional metadata (inside encrypted manifest)
  originalFileName?: string
  mimeType?: string
  fileSize?: number

  // Required to open/decrypt the file later
  envelope: Envelope

  // Optional diagnostic redundancy
  fileIntegritySha256B64?: string
}

/**
 * Encrypted manifest object v1 — stored on IPFS.
 *
 * Integrity rule MUST match Task 5:
 * - integrity.sha256B64 = SHA-256( TextEncoder().encode(JSON.stringify(hashBasis)) ) base64
 * - hashBasis is the object WITHOUT the `integrity` field (see EncryptedManifestObjectV1HashBasis)
 */
export type EncryptedManifestObjectV1 = {
  version: 1
  kind: 'SJ_MANIFEST'

  header: {
    cipher: 'XChaCha20-Poly1305'
    nonce: string // b64 (24 bytes)
    aad: {
      walletPubKey: string
      manifestVersion: 1
      context: 'manifest'
    }
  }

  payload: {
    ciphertextB64: string
  }

  /**
   * Envelope that allows deriving the KEK (via wallet signature unlock flow)
   * and unwrapping the ManifestKey.
   *
   * This is NOT the per-file envelope; it wraps the manifest encryption key.
   */
  envelope: {
    version: 1
    walletPubKey: string
    kekDerivation: {
      method: 'wallet-signature'
      messageTemplateId: 'SJ_UNLOCK_V1' | 'SJ_VAULT_ROOT_V1'
      salt: string // b64
      info: 'SJ-KEK-v1'
    }
    wrap: {
      cipher: 'XChaCha20-Poly1305'
      nonce: string // b64
      ciphertext: string // b64
      context: string
      aadVersion: number
    }
  }

  integrity: {
    sha256B64: string
  }
}

/**
 * Hash basis for EncryptedManifestObjectV1 integrity, excluding `integrity`.
 * This MUST be JSON.stringify'd (not JCS-canonicalized) to match Task 5 behavior.
 */
export type EncryptedManifestObjectV1HashBasis = Omit<EncryptedManifestObjectV1, 'integrity'>

/**
 * Storage interface for the manifest CID pointer.
 * MVP uses localStorage through the default implementation in `storage.ts`.
 */
export type ManifestStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

/**
 * Service-level dependency injection surface to make unit tests deterministic.
 */
export type ManifestServiceDeps = {
  nowIso: () => string
  uuid: () => string

  // crypto
  deriveManifestKey: (kek: Uint8Array) => Promise<Uint8Array>
  encryptManifestV1: (params: {
    manifest: ManifestV1
    manifestKey: Uint8Array
    walletPubKey: string
  }) => Promise<EncryptedManifestObjectV1>
  decryptManifestV1: (params: {
    encrypted: EncryptedManifestObjectV1
    manifestKey: Uint8Array
    walletPubKey: string
  }) => Promise<ManifestV1>

  // ipfs I/O (bytes/object)
  addBytes: (bytes: Uint8Array) => Promise<{ cid: string }>
  catBytes: (cid: string) => Promise<Uint8Array>

  // pointer storage (local)
  getManifestCid: (walletPubKey: string) => string | null
  setManifestCid: (walletPubKey: string, cid: string) => void

  // crypto provider (optional override)
  sodium?: any
}
