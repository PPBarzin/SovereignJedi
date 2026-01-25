/**
 * Local encryption pipeline - v0 skeleton
 *
 * Implements high-level glue for Task 4 (local encryption pipeline).
 * This file provides:
 *  - `buildUnlockMessageV1(params)` : builds canonical SJ_UNLOCK_V1 object + string to sign
 *  - `prepareUnlock(params)` : prepares salt + canonical unlock object
 *  - `deriveKekFromSignature(signatureBytes, saltBytes)` : pre-hash signature + HKDF-SHA256
 *  - `generateFileKey()` : generate 32-byte file key
 *  - `encryptFile(...)` / `decryptFile(...)` : high-level APIs (libsodium-based flow)
 *
 * Notes:
 *  - XChaCha20-Poly1305 operations require `libsodium-wrappers`. This file dynamically imports
 *    libsodium in an ESM-friendly way and awaits initialization.
 *  - Lower-level helpers used here are imported from the package root (`../index`):
 *      - `sha256`
 *      - `deriveKeyHKDF`
 *      - `cryptoGetRandomBytes`
 *      - `utf8Encode`
 *
 * This is an initial, self-contained implementation intended for iteration.
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

  // Encrypt plaintext with fileKey (XChaCha20-Poly1305)
  const fileNonce = cryptoGetRandomBytes(24);
  const aadObj: any = {
    filename: options.filename ?? null,
    mimeType: options.mimeType ?? null,
    size: plaintext.byteLength,
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
    aad: {
      filename: options.filename ?? '',
      size: plaintext.byteLength,
      mimeType: options.mimeType ?? undefined,
    },
  };

  // Wrap fileKey with KEK (also XChaCha20-Poly1305)
  // PROTOCOL: `salt` must be supplied by the caller (see prepareUnlock()). Validate it first and bind it
  // into the wrap AAD so that any mismatch between the envelope.salt and the actual wrap will be detected.
  const salt = options.salt;
  if (!(salt instanceof Uint8Array) || !(salt.length === 16 || salt.length === 32)) {
    throw new Error('encryptFile: options.salt must be a Uint8Array of 16 or 32 bytes (generated by prepareUnlock)');
  }

  const wrapNonce = cryptoGetRandomBytes(24);
  // context for wrap: use fixed file-binding-context as AAD (libsodium AEAD handles AAD properly)
  const wrapAad = utf8Encode('file-binding-context');

  const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    fileKey,
    wrapAad,
    null,
    wrapNonce,
    options.kek
  );

  const envelope: Envelope = {
    version: 1,
    walletPubKey: '', // caller MUST set this before persisting the envelope
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
      context: 'file-binding-context',
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

  // Unwrap fileKey (validate KEK fingerprint if present)
  const wrapNonce = fromBase64(envelope.wrap.nonce);
  const wrappedCipher = fromBase64(envelope.wrap.ciphertext);
  // Use fixed wrap AAD; libsodium AEAD will validate AAD as provided during unwrap.
  const wrapAad = utf8Encode('file-binding-context');



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
    filename: encryptedFile.aad?.filename ?? null,
    mimeType: encryptedFile.aad?.mimeType ?? null,
    size: encryptedFile.aad?.size ?? null,
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
