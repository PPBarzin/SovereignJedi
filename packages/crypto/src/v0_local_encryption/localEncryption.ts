/**
 * Local encryption pipeline - v0 skeleton
 *
 * Implements high-level glue for Task 4 (local encryption pipeline).
 * This file provides:
 *  - `buildUnlockMessageV1(params)` : builds canonical SJ_UNLOCK_V1 object + string to sign
 *  - `deriveKekFromSignature(signatureBytes, saltBytes)` : pre-hash signature + HKDF-SHA256
 *  - `generateFileKey()` : generate 32-byte file key
 *  - `encryptFile(...)` / `decryptFile(...)` : high-level APIs (skeleton) that rely on XChaCha20-Poly1305
 *
 * Notes:
 *  - XChaCha20-Poly1305 operations require `libsodium-wrappers` (or equivalent). This file contains
 *    the high-level flow and will throw if libsodium is not initialized / available.
 *  - Lower-level helpers used here are imported from the package root (`../index`):
 *      - `sha256`
 *      - `deriveKeyHKDF`
 *      - `cryptoGetRandomBytes`
 *
 * This is an initial skeleton intended for iteration. Concrete encryption calls are left as
 * TODOs (libsodium integration).
 */

import canonicalize from 'canonicalize';
import { sha256, deriveKeyHKDF, cryptoGetRandomBytes, utf8Encode, utf8Decode } from '../index';
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
 * Helpers: base64 / base58 (minimal)
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
 * - Uses a dedicated JCS implementation for RFC 8785 compliance.
 * - This guarantees stable, unambiguous serialization required by SJ_UNLOCK_V1.
 * - The project must include a small, tested JCS library (e.g. a RFC8785-compliant canonicalize).
 * ------------------------- */

function canonicalizeJSON(obj: object): string {
  // The `canonicalize` import MUST implement RFC 8785 (JCS) and return the canonical string.
  // This replaces the previous ad-hoc implementation to avoid subtle incompatibilities.
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
 * - Generates a per-envelope salt (32 bytes by default) and returns:
 *   { salt: Uint8Array, unlock: BuildUnlockResult }
 * - Caller MUST sign unlock.messageToSign with the wallet, then derive the KEK using the salt.
 *
 * Flow:
 *  1. const { salt, unlock } = prepareUnlock({ wallet, origin, vaultId })
 *  2. sig = await wallet.signMessage(unlock.messageToSign)
 *  3. kek = await deriveKekFromSignature(sigBytes, salt)
 *  4. const { encryptedFile, envelope } = await encryptFile(plaintext, { kek, salt, filename, mimeType })
 *  5. persist { encryptedFile, envelope } (envelope must include salt and walletPubKey)
 */
export function prepareUnlock(params: {
  origin?: string;
  wallet: string;
  vaultId?: string;
  saltBytes?: Uint8Array;
}): { salt: Uint8Array; unlock: BuildUnlockResult } {
  const salt = params.saltBytes ?? cryptoGetRandomBytes(32);
  if (!(salt instanceof Uint8Array) || !(salt.length === 16 || salt.length === 32)) {
    // normalize/validate: recommend 32 bytes but accept 16 for compatibility if needed
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
 * encryptFile / decryptFile (skeleton)
 *
 * These functions implement the high-level flow:
 *  - encryptFile:
 *      - accept plaintext bytes and optionally aad (metadata)
 *      - encrypt plaintext with fileKey using XChaCha20-Poly1305 (requires libsodium)
 *      - wrap fileKey with KEK (also XChaCha20-Poly1305)
 *      - return EncryptedFile + Envelope
 *
 *  - decryptFile:
 *      - unwrap fileKey using KEK and Envelope
 *      - decrypt ciphertext with fileKey
 *
 * At this stage we provide the flow and shape; actual XChaCha calls are left to libsodium integration.
 * ------------------------- */

/**
 * Attempt to resolve `libsodium-wrappers` if available.
 * Returns `null` when not present. Consumer should call and handle null.
 */
function safeResolveSodium(): any | null {
  try {
    // dynamic require in both node/browser bundlers may not work in this environment,
    // but we attempt a runtime require for Node.js. In browser, libsodium must be loaded separately.
    if (typeof (globalThis as any).sodium !== 'undefined') {
      return (globalThis as any).sodium;
    }
    // Node-ish require (may be blocked by bundlers)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const maybeRequire = (Function('return require'))();
    const libsodium = maybeRequire('libsodium-wrappers');
    return libsodium;
  } catch {
    return null;
  }
}

/**
 * encryptFile
 * - plaintext: Uint8Array
 * - fileKey: Uint8Array (32 bytes) OR undefined (then generated internally)
 * - kek: Uint8Array (32 bytes) used to wrap fileKey
 * - aad: optional object (will be json-serialized into associated data)
 *
 * Returns: { encryptedFile, envelope }
 */
export async function encryptFile(
  plaintext: Uint8Array,
  options: {
    fileKey?: Uint8Array;
    kek: Uint8Array;
    // PROTOCOL: salt MUST be provided by caller (16 or 32 bytes CSPRNG).
    // Caller should obtain salt from prepareUnlock(...) and derive the KEK prior to calling encryptFile().
    salt: Uint8Array;
    filename?: string;
    mimeType?: string;
  }
): Promise<EncryptResult> {
  const sodium = safeResolveSodium();
  if (!sodium) {
    throw new Error(
      'XChaCha20-Poly1305 encryption requires libsodium-wrappers. Initialize libsodium in the environment or install libsodium-wrappers.'
    );
  }

  // ensure libsodium ready
  if (!sodium.ready) {
    // libsodium-wrappers exposes a `ready` Promise in browser bundles
    await sodium.ready;
  }

  const fileKey = options.fileKey ?? cryptoGetRandomBytes(32);
  if (fileKey.length !== 32) throw new Error('fileKey must be 32 bytes');

  // --- Encrypt plaintext with fileKey (XChaCha20-Poly1305) ---
  // nonce for file ciphertext: 24 bytes
  const fileNonce = cryptoGetRandomBytes(24);
  // optional aad: include filename and mimeType in AAD JSON
  const aadObj: any = {
    filename: options.filename ?? null,
    mimeType: options.mimeType ?? null,
    size: plaintext.byteLength,
  };
  const aadJson = canonicalizeJSON(aadObj);
  const aadBytes = utf8Encode(aadJson);

  // sodium-native usage (pseudocode):
  // const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aadBytes, null, fileNonce, fileKey)
  // It returns ciphertext with tag appended in libsodium implementation.
  const cipherBytes: Uint8Array = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aadBytes,
    null,
    fileNonce,
    fileKey
  );

  // Build EncryptedFile object
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

  // --- Wrap fileKey with KEK (also XChaCha20-Poly1305) ---
  const wrapNonce = cryptoGetRandomBytes(24);
  // context for wrap: associate file-binding-context (could include file id or filename)
  const wrapAad = utf8Encode('file-binding-context');

  const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    fileKey,
    wrapAad,
    null,
    wrapNonce,
    options.kek
  );

  // PROTOCOL: `salt` must be supplied by the caller (see prepareUnlock()). Validate and attach it to the envelope.
  const salt = options.salt;
  if (!(salt instanceof Uint8Array) || !(salt.length === 16 || salt.length === 32)) {
    throw new Error('encryptFile: options.salt must be a Uint8Array of 16 or 32 bytes (generated by prepareUnlock)');
  }

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
  const sodium = safeResolveSodium();
  if (!sodium) {
    throw new Error(
      'XChaCha20-Poly1305 decryption requires libsodium-wrappers. Initialize libsodium in the environment or install libsodium-wrappers.'
    );
  }

  if (!sodium.ready) {
    await sodium.ready;
  }

  // unwrap fileKey
  const wrapNonce = fromBase64(envelope.wrap.nonce);
  const wrappedCipher = fromBase64(envelope.wrap.ciphertext);
  const wrapAad = utf8Encode('file-binding-context');

  const fileKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    wrappedCipher,
    wrapAad,
    wrapNonce,
    kek
  );

  if (!(fileKey instanceof Uint8Array)) {
    // libsodium sometimes returns Buffer in Node; normalize
    if (ArrayBuffer.isView(fileKey)) {
      // @ts-ignore
      const arr = new Uint8Array(fileKey.buffer.slice(fileKey.byteOffset, fileKey.byteOffset + fileKey.byteLength));
      // use arr
      // but continue
      // eslint-disable-next-line no-param-reassign
      (fileKey as any) = arr;
    } else {
      throw new Error('Failed to unwrap fileKey');
    }
  }

  // decrypt payload
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
    fileKey
  );

  // Normalize Buffer -> Uint8Array
  if (ArrayBuffer.isView(plaintext) && !(plaintext instanceof Uint8Array)) {
    const arr = new Uint8Array(plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength));
    return arr;
  }

  return new Uint8Array(plaintext);
}

/* -------------------------
 * Exports
 * ------------------------- */

export default {
  buildUnlockMessageV1,
  deriveKekFromSignature,
  generateFileKey,
  encryptFile,
  decryptFile,
};
```

```SovereignJedi/packages/crypto/src/v0_local_encryption/types.ts#L1-300
/**
 * Types for local encryption pipeline (v0)
 *
 * Minimal initial skeleton of TypeScript types used by localEncryption.ts
 */

export type UnlockMessageV1 = {
  sj: 'SovereignJedi';
  ver: '1';
  type: 'UNLOCK';
  origin: string;
  wallet: string; // base58
  nonce: string; // base64 16 bytes
  issuedAt: string; // ISO-8601 UTC
  expiresAt: string; // ISO-8601 UTC
  vaultId: string;
};

export type BuildUnlockResult = {
  canonicalObject: UnlockMessageV1;
  messageToSign: string;
};

export type EncryptedFile = {
  version: number;
  cipher: 'XChaCha20-Poly1305' | string;
  nonce: string; // base64 (24 bytes)
  ciphertext: string; // base64
  aad?: {
    filename?: string;
    size?: number;
    mimeType?: string;
  };
};

export type Envelope = {
  version: number;
  walletPubKey: string; // base58
  kekDerivation: {
    method: 'wallet-signature' | string;
    messageTemplateId: string;
    salt: string; // base64
    info?: string;
  };
  wrap: {
    cipher: 'XChaCha20-Poly1305' | string;
    nonce: string; // base64
    ciphertext: string; // base64
    context?: string;
  };
};

export type EncryptResult = {
  encryptedFile: EncryptedFile;
  envelope: Envelope;
  fileKey?: Uint8Array; // optional (useful for tests); do NOT persist in production
};
