/**
 * Local encryption pipeline - v0
 *
 * Implements the Task 4 local (offline) cryptographic pipeline:
 * - Canonical unlock message generation (SJ_UNLOCK_V1)
 * - KEK derivation from wallet signature via HKDF-SHA256 (implementation detail)
 * - Per-file encryption (XChaCha20-Poly1305)
 * - Envelope wrap/unwrap of the per-file key (XChaCha20-Poly1305)
 *
 * IMPORTANT (OQ-06 system-wide compliance):
 * - This module still exposes `deriveKekFromSignature(signatureBytes, saltBytes)` as a low-level primitive.
 * - The PUBLIC API MUST NOT expose a bypass that allows KEK derivation without expiry enforcement.
 * - Expiry enforcement must happen at the public entrypoint (e.g. `@sj/crypto` must require
 *   `deriveKekFromUnlockSignature({ signatureBytes, saltBytes, unlock })` which calls an expiry assertion
 *   before delegating to the low-level primitive).
 *
 * Protocol note (Wrap AAD Binding V3):
 * - The wrap AAD MUST bind immutable technical header metadata via:
 *     headerHash = SHA-256(canonicalize(headerImmutableSubset))
 *   where headerImmutableSubset = { originalFileName, mimeType, fileSize, fileId }
 * - wrapAAD = canonicalize({ v: 3, salt, walletPubKey, fileId, headerHash })
 * - headerHash is NOT stored separately; it is recomputed from the header present in the package.
 *
 * Notes:
 * - XChaCha20-Poly1305 operations require `libsodium-wrappers-sumo`. This file dynamically imports
 *   libsodium in an ESM-friendly way and awaits initialization.
 * - Lower-level helpers used here are imported from the package root (`../index`):
 *   - sha256
 *   - deriveKeyHKDF
 *   - cryptoGetRandomBytes
 *   - utf8Encode
 */

import canonicalize from 'canonicalize';
import { sha256, deriveKeyHKDF, cryptoGetRandomBytes, utf8Encode } from '../index';
import type {
  UnlockMessageV1,
  BuildUnlockResult,
  EncryptedFile,
  Envelope,
  EncryptResult,
} from './types';

// Constants
const UNLOCK_TEMPLATE_ID = 'SJ_UNLOCK_V1';
const KEK_INFO = utf8Encode('SJ-KEK-v1');
const KEK_LENGTH = 32; // bytes

// Wrap AAD Binding V3 (V2 is not supported; no fallback in read)
const WRAP_AAD_V3 = 3;

/* -------------------------
 * Helpers: base64
 * ------------------------- */

/**
 * base64 encode Uint8Array
 */
function toBase64(bytes: Uint8Array): string {
  // Browser-friendly approach
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const str = Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join('');
    return window.btoa(str);
  }

  // Node fallback
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  throw new Error('No base64 encoder available');
}

/**
 * base64 decode to Uint8Array
 */
function fromBase64(s: string): Uint8Array {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    const bin = window.atob(s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  throw new Error('No base64 decoder available');
}

/* -------------------------
 * JSON Canonicalization (RFC 8785) — strict JCS
 * ------------------------- */

function canonicalizeJSON(obj: object): string {
  // The `canonicalize` import MUST implement RFC 8785 (JCS) and return the canonical string.
  return canonicalize(obj);
}

/* -------------------------
 * buildUnlockMessageV1
 * ------------------------- */

export function buildUnlockMessageV1(params: {
  origin?: string; // default to window.location.origin when in browser
  wallet: string; // base58 pubkey
  vaultId?: string; // default 'local-default'
  nonceBytes?: Uint8Array; // optional 16 bytes
  issuedAt?: string; // ISO string
  expiresAt?: string; // ISO string
}): BuildUnlockResult {
  const origin = params.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const vaultId = params.vaultId ?? 'local-default';

  const issuedAt = params.issuedAt ?? new Date().toISOString();
  // default expiresAt = issuedAt + 10 minutes
  const expiresAt = params.expiresAt ?? new Date(Date.parse(issuedAt) + 10 * 60 * 1000).toISOString();

  const nonceBytes = params.nonceBytes ?? cryptoGetRandomBytes(16);
  if (nonceBytes.length !== 16) {
    throw new Error('nonceBytes must be 16 bytes');
  }

  const canonicalObject: UnlockMessageV1 = {
    sj: 'SovereignJedi',
    ver: '1',
    type: 'UNLOCK',
    origin,
    wallet: params.wallet,
    nonce: toBase64(nonceBytes),
    issuedAt,
    expiresAt,
    vaultId,
  };

  const jcs = canonicalizeJSON(canonicalObject);
  const messageToSign = `${UNLOCK_TEMPLATE_ID}\n${jcs}`;

  return { canonicalObject, messageToSign };
}

/**
 * prepareUnlock
 * - Generates a per-envelope salt (16 or 32 bytes by default) and returns:
 *   { salt: Uint8Array, unlock: BuildUnlockResult }
 *
 * Flow:
 *  1. const { salt, unlock } = prepareUnlock({ wallet, origin, vaultId })
 *  2. sig = await wallet.signMessage(unlock.messageToSign)
 *  3. kek = await deriveKekFromSignature(sigBytes, salt)
 *  4. const { encryptedFile, envelope } = await encryptFile(plaintext, { kek, salt, filename, mimeType })
 *  5. persist { encryptedFile, envelope } with envelope.kekDerivation.salt and envelope.walletPubKey set
 */
export function prepareUnlock(params: {
  origin?: string;
  wallet: string;
  vaultId?: string;
  saltBytes?: Uint8Array;
}): { salt: Uint8Array; unlock: BuildUnlockResult } {
  const salt = params.saltBytes ?? cryptoGetRandomBytes(32);
  if (!(salt instanceof Uint8Array) || !(salt.length === 16 || salt.length === 32)) {
    throw new Error('prepareUnlock: saltBytes must be a Uint8Array of 16 or 32 bytes');
  }
  const unlock = buildUnlockMessageV1({
    origin: params.origin,
    wallet: params.wallet,
    vaultId: params.vaultId,
  });
  return { salt, unlock };
}

/* -------------------------
 * deriveKekFromSignature
 * Steps:
 *  - ikm = SHA-256(sigBytes)
 *  - kek = HKDF-SHA256(ikm, salt, info="SJ-KEK-v1") -> 32 bytes
 * ------------------------- */

export async function deriveKekFromSignature(signatureBytes: Uint8Array, saltBytes: Uint8Array | null): Promise<Uint8Array> {
  if (!(signatureBytes instanceof Uint8Array)) {
    signatureBytes = new Uint8Array(signatureBytes);
  }
  const ikm = await sha256(signatureBytes); // Uint8Array
  const salt = saltBytes && saltBytes.length > 0 ? saltBytes : null;
  const kek = await deriveKeyHKDF(ikm, salt, KEK_INFO, KEK_LENGTH);
  return new Uint8Array(kek);
}

/* -------------------------
 * generateFileKey
 * ------------------------- */

export function generateFileKey(): Uint8Array {
  return cryptoGetRandomBytes(32);
}

/* -------------------------
 * libsodium resolution (ESM/CJS friendly)
 * ------------------------- */

/**
 * Resolve libsodium in a robust ESM-friendly way.
 *
 * Behavior:
 * - If `globalThis.sodium` exists (libsodium already loaded in the global scope), reuse it.
 * - Otherwise dynamically import `libsodium-wrappers` and await `sodium.ready`.
 *
 * Returns null when libsodium cannot be loaded.
 */
async function getSodium(): Promise<any> {
  // Strict libsodium-only resolver (simplified).
  // Behaviour:
  //  - If globalThis.sodium exists, reuse it (await readiness).
  //  - Attempt to import 'libsodium-wrappers-sumo' only (preferred and required).
  //  - If it cannot be loaded, fail hard with an explicit error.
  if (typeof (globalThis as any).sodium !== 'undefined') {
    const g = (globalThis as any).sodium;
    if (g && g.ready) {
      await g.ready;
    }
    return g;
  }

  try {
    // Only attempt the sumo build. This package is required for Task 4.
    const mod = await import('libsodium-wrappers-sumo');
    const sodium = (mod && (mod as any).default) ? (mod as any).default : mod;
    if (sodium && sodium.ready) {
      await sodium.ready;
    }
    return sodium;
  } catch (err) {
    // Fail hard and give actionable error message.
    throw new Error(
      'libsodium-wrappers-sumo is required but could not be loaded. Install and ensure the runtime can resolve "libsodium-wrappers-sumo". Original error: ' +
        (err && err.message ? err.message : String(err))
    );
  }
}

/* -------------------------
 * encryptFile / decryptFile
 * ------------------------- */

/**
 * encryptFile
 * - plaintext: Uint8Array
 * - options:
 *    - fileKey?: Uint8Array
 *    - kek: Uint8Array (32 bytes) used to wrap fileKey
 *    - salt: Uint8Array (16 or 32 bytes) generated by caller (prepareUnlock)
 *    - filename?: string
 *    - mimeType?: string
 *
 * Returns: { encryptedFile, envelope } (fileKey included only in test modes)
 */
export async function encryptFile(
  plaintext: Uint8Array,
  options: {
    fileKey?: Uint8Array;
    kek: Uint8Array;
    salt: Uint8Array;
    walletPubKey: string; // REQUIRED (Protocol V3)
    fileId?: string; // optional (Protocol V3) — if omitted, generated and stored in EncryptedFile
    filename?: string;
    mimeType?: string;
  }
): Promise<EncryptResult> {
  const sodium = await getSodium();
  if (!sodium) {
    throw new Error(
      'XChaCha20-Poly1305 encryption requires libsodium-wrappers. Ensure it is installed and available to the runtime.'
    );
  }

  const fileKey = options.fileKey ?? cryptoGetRandomBytes(32);
  if (fileKey.length !== 32) throw new Error('fileKey must be 32 bytes');

  // Protocol V2 requires walletPubKey and uses fileId for wrap AAD binding.
  if (!options.walletPubKey || typeof options.walletPubKey !== 'string' || options.walletPubKey.trim().length === 0) {
    throw new Error('encryptFile: walletPubKey is required (must be a non-empty base58 string)');
  }

  const fileId = options.fileId ?? toBase64(cryptoGetRandomBytes(16));

  // Technical immutable header fields (non-secret; part of integrity)
  const originalFileName = options.filename ?? '';
  const mimeType = options.mimeType ?? '';
  const fileSize = plaintext.byteLength;

  // Encrypt plaintext with fileKey (XChaCha20-Poly1305)
  const fileNonce = cryptoGetRandomBytes(24);
  const aadObj: any = {
    // Immutable technical header subset (bound via headerHash in wrap AAD V3)
    originalFileName,
    mimeType,
    fileSize,
    fileId,

    // Legacy-friendly aliases (kept to minimize surface; still bound via canonicalization in decrypt)
    filename: originalFileName,
    size: fileSize,
  };
  const aadJson = canonicalizeJSON(aadObj);
  const aadBytes = utf8Encode(aadJson);

  // libsodium: crypto_aead_xchacha20poly1305_ietf_encrypt(message, additionalData, null, nonce, key)
  const cipherBytes: Uint8Array = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aadBytes,
    null,
    fileNonce,
    fileKey
  );

  const encryptedFile: EncryptedFile = {
    version: 1,
    cipher: 'XChaCha20-Poly1305',
    nonce: toBase64(fileNonce),
    ciphertext: toBase64(cipherBytes),

    // Technical header fields (non-secret) — these MUST remain immutable; tampering breaks decrypt (via wrap AAD V3)
    fileId,
    originalFileName,
    mimeType,
    fileSize,

    // Keep AAD populated with the same immutable metadata (non-secret)
    aad: {
      originalFileName,
      mimeType,
      fileSize,
      fileId,

      // Legacy-friendly aliases
      filename: originalFileName,
      size: fileSize,
    },
  };

  // Wrap fileKey with KEK (also XChaCha20-Poly1305)
  // PROTOCOL: `salt` must be supplied by the caller (see prepareUnlock()). Validate it first.
  const salt = options.salt;
  if (!(salt instanceof Uint8Array) || !(salt.length === 16 || salt.length === 32)) {
    throw new Error('encryptFile: options.salt must be a Uint8Array of 16 or 32 bytes (generated by prepareUnlock)');
  }

  const wrapNonce = cryptoGetRandomBytes(24);

  // Wrap AAD Binding V3:
  // headerHash = SHA-256( canonicalize({ originalFileName, mimeType, fileSize, fileId }) )
  // wrapAAD = canonicalize({ v: 3, salt, walletPubKey, fileId, headerHash })
  const headerImmutableSubset = {
    originalFileName,
    mimeType,
    fileSize,
    fileId,
  };
  const headerHashBytes = await sha256(utf8Encode(canonicalizeJSON(headerImmutableSubset)));
  const headerHash = toBase64(new Uint8Array(headerHashBytes));

  const wrapAadObjV3 = {
    v: WRAP_AAD_V3,
    salt: toBase64(salt),
    walletPubKey: options.walletPubKey,
    fileId,
    headerHash,
  };
  const wrapAad = utf8Encode(canonicalizeJSON(wrapAadObjV3));

  const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    fileKey,
    wrapAad,
    null,
    wrapNonce,
    options.kek
  );

  const envelope: Envelope = {
    version: 1,
    walletPubKey: options.walletPubKey, // REQUIRED by protocol (no empty value allowed)
    kekDerivation: {
      method: 'wallet-signature',
      messageTemplateId: UNLOCK_TEMPLATE_ID,
      salt: toBase64(salt),
      info: 'SJ-KEK-v1',
    },
    wrap: {
      cipher: 'XChaCha20-Poly1305',
      nonce: toBase64(wrapNonce),
      ciphertext: toBase64(wrapped),
      context: 'wrap-aad-v3',
      aadVersion: WRAP_AAD_V3,
    },
  };

  // Only include fileKey in returned object for tests / explicit opt-in via env flag.
  const result: Partial<EncryptResult> = { encryptedFile, envelope };
  const allowExpose = process.env.NODE_ENV === 'test' || process.env.SJ_ALLOW_TEST_FILEKEY === '1';
  if (allowExpose) {
    result.fileKey = fileKey;
  }
  return result as EncryptResult;
}

/**
 * decryptFile
 * - encryptedFile: EncryptedFile
 * - envelope: Envelope
 * - kek: Uint8Array (derived KEK) used to unwrap fileKey
 *
 * Returns plaintext Uint8Array or throws on failure.
 */
export async function decryptFile(encryptedFile: EncryptedFile, envelope: Envelope, kek: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (!sodium) {
    throw new Error(
      'XChaCha20-Poly1305 decryption requires libsodium-wrappers. Ensure it is installed and available to the runtime.'
    );
  }

  // Unwrap fileKey (Wrap AAD Binding V3 — no V1/V2 fallback)
  const wrapNonce = fromBase64(envelope.wrap.nonce);
  const wrappedCipher = fromBase64(envelope.wrap.ciphertext);

  const saltB64 = envelope.kekDerivation?.salt;
  if (!saltB64 || typeof saltB64 !== 'string') {
    throw new Error('decryptFile: envelope.kekDerivation.salt is required for wrap AAD V3');
  }

  const walletPubKey = envelope.walletPubKey;
  if (!walletPubKey || typeof walletPubKey !== 'string' || walletPubKey.trim().length === 0) {
    throw new Error('decryptFile: envelope.walletPubKey is required for wrap AAD V3');
  }

  const fileId = (encryptedFile as any).fileId ?? encryptedFile?.aad?.fileId;
  if (!fileId || typeof fileId !== 'string') {
    throw new Error('decryptFile: encryptedFile.fileId is required for wrap AAD V3');
  }

  // Immutable metadata must be present and must match; any tamper must break unwrap via headerHash binding
  const originalFileName = (encryptedFile as any).originalFileName ?? encryptedFile?.aad?.originalFileName ?? encryptedFile?.aad?.filename ?? null;
  const mimeType = (encryptedFile as any).mimeType ?? encryptedFile?.aad?.mimeType ?? null;
  const fileSize = (encryptedFile as any).fileSize ?? encryptedFile?.aad?.fileSize ?? encryptedFile?.aad?.size ?? null;

  const headerImmutableSubset = {
    originalFileName,
    mimeType,
    fileSize,
    fileId,
  };
  const headerHashBytes = await sha256(utf8Encode(canonicalizeJSON(headerImmutableSubset)));
  const headerHash = toBase64(new Uint8Array(headerHashBytes));

  const wrapAadObjV3 = {
    v: WRAP_AAD_V3,
    salt: saltB64,
    walletPubKey,
    fileId,
    headerHash,
  };
  const wrapAad = utf8Encode(canonicalizeJSON(wrapAadObjV3));

  const fileKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    wrappedCipher,
    wrapAad,
    wrapNonce,
    kek
  );

  // Normalize possible Buffer/TypedArray shapes to Uint8Array
  let normalizedFileKey: Uint8Array;
  if (fileKey instanceof Uint8Array) {
    normalizedFileKey = fileKey;
  } else if (ArrayBuffer.isView(fileKey)) {
    // @ts-ignore
    normalizedFileKey = new Uint8Array(fileKey.buffer.slice(fileKey.byteOffset, fileKey.byteOffset + fileKey.byteLength));
  } else {
    throw new Error('Failed to unwrap fileKey');
  }

  // Decrypt payload
  const nonce = fromBase64(encryptedFile.nonce);
  const ciphertext = fromBase64(encryptedFile.ciphertext);
  const aadJson = canonicalizeJSON({
    // Immutable technical metadata (V3): MUST match encryption AAD exactly
    originalFileName: (encryptedFile as any).originalFileName ?? encryptedFile.aad?.originalFileName ?? null,
    mimeType: (encryptedFile as any).mimeType ?? encryptedFile.aad?.mimeType ?? null,
    fileSize: (encryptedFile as any).fileSize ?? encryptedFile.aad?.fileSize ?? null,
    fileId: (encryptedFile as any).fileId ?? encryptedFile.aad?.fileId ?? null,

    // Legacy-friendly aliases (kept for compatibility with existing artefacts/tests)
    filename: encryptedFile.aad?.filename ?? (encryptedFile as any).originalFileName ?? null,
    size: encryptedFile.aad?.size ?? (encryptedFile as any).fileSize ?? null,
  });
  const aadBytes = utf8Encode(aadJson);

  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    aadBytes,
    nonce,
    normalizedFileKey
  );

  // Normalize Buffer -> Uint8Array
  if (ArrayBuffer.isView(plaintext) && !(plaintext instanceof Uint8Array)) {
    const arr = new Uint8Array((plaintext as any).buffer.slice((plaintext as any).byteOffset, (plaintext as any).byteOffset + (plaintext as any).byteLength));
    return arr;
  }

  return new Uint8Array(plaintext);
}

/* -------------------------
 * Exports
 * ------------------------- */

export default {
  buildUnlockMessageV1,
  prepareUnlock,
  deriveKekFromSignature,
  generateFileKey,
  encryptFile,
  decryptFile,
};
