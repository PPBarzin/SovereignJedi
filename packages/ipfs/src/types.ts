/**
 * @sj/ipfs — types (Task 5)
 *
 * Task 5 uploads a single serialized object to IPFS and returns its CID.
 * MVP mode uses Kubo HTTP API (IPFS Desktop) for real interoperability; Helia
 * in-browser remains a fallback option. The UI must never call IPFS directly;
 * it should call the abstraction functions exposed by this package.
 *
 * Security / invariants (from spec):
 * - No plaintext leaves device (upload ciphertext only).
 * - Upload gated elsewhere by IdentityVerified && VaultUnlocked.
 * - No secret persistence (fileKey/KEK/clear bytes).
 * - CID must represent the entire encrypted payload object.
 * - A local SHA-256 hash of the encrypted object (without integrity) is mandatory.
 *
 * IMPORTANT (circularity rule):
 * - integrity.sha256B64 is computed over the serialized bytes of:
 *     { version, header, envelope, payload }
 *   i.e. WITHOUT the integrity field.
 * - Then integrity.sha256B64 is injected and the full object is uploaded.
 */
import type { EncryptedFile } from '@sj/crypto'

/**
 * Minimal representation of the Task 4 Envelope shape.
 * We intentionally keep it permissive to avoid divergence with @sj/crypto's types.
 *
 * For Task 5, Envelope is treated as an opaque JSON object (no secrets inside).
 */
export type EnvelopeLike = Record<string, any>

// Header is exactly Task 4 EncryptedFile (1:1), no additional wrapper.
export type Header = EncryptedFile

/**
 * Task 5 payload. Per spec, ciphertext is uploaded as base64 inside payload.
 * This is intentionally redundant with header.ciphertext for clarity/compat:
 * - header remains the Task 4 EncryptedFile header object (1:1)
 * - payload is the IPFS upload payload wrapper
 */
export type EncryptedIpfsPayloadV1 = {
  ciphertextB64: string
}

/**
 * Integrity block (defense in depth).
 * sha256B64 is computed on the bytes of the object WITHOUT integrity.
 */
export type EncryptedIpfsIntegrityV1 = {
  sha256B64: string
}

/**
 * Spec-mandated shape for the object uploaded to IPFS (single serialized object).
 */
export type EncryptedIpfsObjectV1 = {
  version: 1
  header: Header
  envelope: EnvelopeLike
  payload: EncryptedIpfsPayloadV1
  integrity: EncryptedIpfsIntegrityV1
}

/**
 * Helper type: the "hash basis" object used to compute integrity.sha256B64.
 * MUST exclude `integrity` to avoid circularity.
 */
export type EncryptedIpfsObjectV1HashBasis = Omit<EncryptedIpfsObjectV1, 'integrity'>

/**
 * Result of addBytes() low-level API.
 */
export type AddBytesResult = {
  cid: string
  size: number
}

/**
 * Result of addEncryptedPackage() high-level API.
 */
export type AddEncryptedPackageResult = {
  cid: string
}

/**
 * Minimal configuration for IPFS clients.
 *
 * MVP decision: prefer Kubo HTTP API (IPFS Desktop) for uploads; Helia in-browser
 * is a fallback option. Bootstrap multiaddrs are only required for Helia.
 *
 * We do not put a default multiaddr in code. Absence MUST throw explicitly
 * when Helia is used.
 */
export type IpfsClientConfig = {
  /**
   * Optional base URL for Kubo HTTP API (e.g. http://127.0.0.1:5001).
   * If omitted, the client will use its default.
   */
  kuboApiBaseUrl?: string

  /**
   * CSV string of multiaddrs OR already-split list of multiaddrs (Helia fallback).
   * Example:
   *  /ip4/127.0.0.1/tcp/15002/ws/p2p/<PEER_ID>
   */
  bootstrapMultiaddrs: string[] | string

  /**
   * Optional: enable technical debug logging for IPFS client operations.
   */
  debug?: boolean

  /**
   * Optional: maximum object size (bytes) enforced by the caller (UI/orchestrator).
   * Spec says MVP: 100MB. Enforcement may also be done at UI.
   */
  maxBytes?: number

  /**
   * Optional: timeout (ms) for IPFS operations (client-side).
   */
  timeoutMs?: number
}
