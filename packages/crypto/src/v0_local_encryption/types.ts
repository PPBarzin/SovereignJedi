/**
 * Types for v0 local encryption pipeline
 *
 * These types describe the high-level JSON artefacts used by the local encryption
 * implementation for Task 4:
 *  - UnlockMessageV1 / BuildUnlockResult  : canonical unlock message + string to sign
 *  - EncryptedFile                          : file ciphertext + header / associated data
 *  - Envelope                               : wrapped fileKey metadata and wrapped ciphertext
 *  - EncryptResult                          : convenience result returned by encryptFile
 *
 * Protocol notes (explicit)
 * -------------------------
 * - Salt is a first-class protocol parameter (NOT merely "record-keeping").
 *   The caller MUST generate a per-envelope `salt` (16 or 32 bytes CSPRNG) and:
 *     1) call `prepareUnlock(...)` (or equivalent) to obtain the `unlock` object and the `salt`;
 *     2) have the wallet sign the canonical `unlock.messageToSign`;
 *     3) derive the KEK via `deriveKekFromSignature(signatureBytes, salt)`;
 *     4) call `encryptFile(...)` passing the derived `kek` and the same `salt`;
 *     5) persist `{ encryptedFile, envelope }` where `envelope.kekDerivation.salt` contains the base64-encoded salt.
 *
 * - The API surfaces a `prepareUnlock`/`buildUnlockMessageV1` pattern: prepare (generate salt + canonical unlock),
 *   sign, derive KEK with salt, then encrypt. This makes the salt usage explicit and avoids subtle protocol mistakes.
 *
 * - File keys (`fileKey`) MUST NEVER be exposed in production APIs or persisted. In the implementation the
 *   only time `fileKey` may be returned is under test-only conditions (NODE_ENV === 'test' or explicit test flag).
 *
 * Notes:
 *  - Binary fields in the JSON artefacts are represented as base64-encoded strings.
 *  - `walletPubKey` values are represented as base58 strings.
 *  - These are intentionally minimal and focused on the data shapes required for the MVP.
 */

/* -------------------------
 * Unlock message (SJ_UNLOCK_V1)
 * ------------------------- */

/**
 * Structure of the canonical object to be signed for a session unlock (SJ_UNLOCK_V1).
 * All fields are required for canonicalization/signature.
 *
 * Serialization rules:
 *  - nonce is base64-encoded 16 bytes
 *  - issuedAt / expiresAt are ISO-8601 UTC strings
 */
export type UnlockMessageV1 = {
  sj: 'SovereignJedi';
  ver: '1';
  type: 'UNLOCK';
  origin: string; // window.location.origin
  wallet: string; // wallet public key (base58)
  nonce: string; // base64 (16 bytes)
  issuedAt: string; // ISO-8601 UTC
  expiresAt: string; // ISO-8601 UTC
  vaultId: string; // stable string (ex: 'local-default')
};

/**
 * Result returned by buildUnlockMessageV1
 */
export type BuildUnlockResult = {
  canonicalObject: UnlockMessageV1;
  // string that must be signed by the wallet (prefixed header + JCS JSON)
  messageToSign: string;
};

/* -------------------------
 * Encrypted file & envelope artefacts
 * ------------------------- */

/**
 * Associated data carried with the encrypted file.
 * Only non-sensitive metadata must be present.
 */
export type EncryptedFileAAD = {
  filename?: string;
  size?: number;
  mimeType?: string;
};

/**
 * EncryptedFile represents the ciphertext and minimal header/meta for a single encrypted file.
 *
 * Binary fields (nonce, ciphertext) are base64-encoded strings.
 */
export type EncryptedFile = {
  version: number;
  cipher: string; // example: 'XChaCha20-Poly1305'
  // nonce used for the file ciphertext (base64, 24 bytes for XChaCha20-Poly1305)
  nonce: string;
  // ciphertext (includes auth tag if algorithm appends it) -> base64
  ciphertext: string;
  // optional associated data describing the file; MUST NOT contain secrets
  aad?: EncryptedFileAAD;
  // optional: createdAt, fileId, etc. (non-sensitive)
  [k: string]: any;
};

/**
 * KEK derivation descriptor stored in the envelope.
 * Salt is base64-encoded.
 */
export type KekDerivation = {
  method: 'wallet-signature' | string;
  messageTemplateId: string; // e.g. 'SJ_UNLOCK_V1'
  salt: string; // base64 salt (16 or 32 bytes)
  info?: string; // HKDF info (ex: "SJ-KEK-v1")
};

/**
 * Wrap object within an Envelope that carries the wrapped (encrypted) fileKey.
 * Binary fields are base64-encoded.
 */
export type EnvelopeWrap = {
  cipher: string; // 'XChaCha20-Poly1305' or other
  nonce: string; // base64 (24 bytes for XChaCha20-Poly1305)
  ciphertext: string; // base64 (wrapped fileKey ciphertext)
  context?: string; // contextual string used as AAD for wrapping (ex: "file-binding-context")
};

/**
 * Envelope contains metadata allowing the recipient (client in unlocked session)
 * to derive the KEK and unwrap the `fileKey`.
 *
 * `walletPubKey` is the public key (base58) of the wallet associated with the envelope.
 * All binary fields are base64-encoded strings.
 */
export type Envelope = {
  version: number;
  walletPubKey: string; // base58
  kekDerivation: KekDerivation;
  wrap: EnvelopeWrap;
  [k: string]: any;
};

/* -------------------------
 * Convenience / internal types
 * ------------------------- */

/**
 * Result object returned by encryptFile() high-level helper.
 * - `fileKey` is optionally returned for test harnesses only (MUST NOT be persisted in production).
 */
export type EncryptResult = {
  encryptedFile: EncryptedFile;
  envelope: Envelope;
  fileKey?: Uint8Array;
};

/* -------------------------
 * Error / validation helpers (optional)
 * ------------------------- */

/**
 * Minimal structure to represent a validation error when parsing/verifying artefacts.
 */
export type DecryptError = {
  message: string;
  code?: string;
  cause?: any;
};

/* -------------------------
 * Exports
 * ------------------------- */
// (All types above are exported using `export type ...` declarations)
