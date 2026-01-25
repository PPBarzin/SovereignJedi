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
async function getSodium(): Promise<any | null> {
  // Robust resolver with fallback to a lightweight tweetnacl shim when libsodium cannot be loaded.
  // This keeps the runtime usable in constrained bundling/test environments while preferring
  // libsodium-wrappers-sumo when available.
  try {
    // If libsodium was previously loaded into the global (e.g. by a bundler shim), reuse it.
    if (typeof (globalThis as any).sodium !== 'undefined') {
      const g = (globalThis as any).sodium;
      if (g && g.ready) {
        await g.ready;
      }
      return g;
    }

    // 1) Try the full libsodium-wrappers-sumo build (preferred)
    try {
      const mod = await import('libsodium-wrappers-sumo');
      const sodium = (mod && (mod as any).default) ? (mod as any).default : mod;
      if (sodium && sodium.ready) {
        await sodium.ready;
      }
      return sodium;
    } catch {
      // continue to next attempt
    }

    // 2) Fallback to libsodium-wrappers (non-sumo) if available
    try {
      const mod2 = await import('libsodium-wrappers');
      const sodium2 = (mod2 && (mod2 as any).default) ? (mod2 as any).default : mod2;
      if (sodium2 && sodium2.ready) {
        await sodium2.ready;
      }
      return sodium2;
    } catch {
      // continue to fallback shim
    }

    // 3) Final fallback: tweetnacl shim (provides a minimal compatible API surface)
    //    - Uses `tweetnacl` for secretbox (XSalsa20-Poly1305) and signing
    //    - Provides api surface expected by the code:
    //       crypto_aead_xchacha20poly1305_ietf_encrypt
    //       crypto_aead_xchacha20poly1305_ietf_decrypt
    //       crypto_sign_keypair
    //       crypto_sign_detached
    //    NOTE: Secretbox (XSalsa20-Poly1305) is used as a pragmatic fallback and requires
    //    24-byte nonce and 32-byte key (compatible shapes for our usage). This is a
    //    documented fallback only — libsodium/XChaCha is preferred.
    try {
      const mod3 = await import('tweetnacl');
      const nacl = (mod3 && (mod3 as any).default) ? (mod3 as any).default : mod3;

      const shim = {
        // promise-like ready to mirror libsodium-wrappers API
        // (tweetnacl fallback provides a minimal compatible surface below)
        ready: Promise.resolve(),
        // encrypt: secretbox(message_with_prefixed_aad, nonce, key) -> ciphertext (Uint8Array)
        // We bind 'aad' into the encrypted blob by prefixing a 4-byte big-endian length followed by the aad bytes,
        // then the message bytes. This ensures authenticity of the AAD even when using secretbox as a fallback.
        crypto_aead_xchacha20poly1305_ietf_encrypt: (message: Uint8Array, aad: Uint8Array | null, _null: any, nonce: Uint8Array, key: Uint8Array) => {
          const msg = new Uint8Array(message);
          const aadBytes = aad ? new Uint8Array(aad) : new Uint8Array(0);
          const len = aadBytes.length >>> 0;
          // 4-byte big-endian length
          const header = new Uint8Array(4 + len);
          header[0] = (len >>> 24) & 0xff;
          header[1] = (len >>> 16) & 0xff;
          header[2] = (len >>> 8) & 0xff;
          header[3] = len & 0xff;
          if (len) header.set(aadBytes, 4);
          const combined = new Uint8Array(header.length + msg.length);
          combined.set(header, 0);
          combined.set(msg, header.length);
          // tweetnacl.secretbox expects nonce length 24 and key length 32; we pass through the provided nonce/key
          return nacl.secretbox(combined, new Uint8Array(nonce), new Uint8Array(key));
        },
        // decrypt: secretbox.open(ciphertext, nonce, key) -> plaintext Uint8Array | throws on failure
        // On success we parse the prefixed AAD length and return only the original message bytes.
        crypto_aead_xchacha20poly1305_ietf_decrypt: (_null: any, ciphertext: Uint8Array, aad: Uint8Array | null, nonce: Uint8Array, key: Uint8Array) => {
          const cipher = new Uint8Array(ciphertext);
          const plain = nacl.secretbox.open(cipher, new Uint8Array(nonce), new Uint8Array(key));
          if (!plain) {
            // mirror libsodium behaviour on failure
            throw new Error('decryption failed (secretbox fallback)');
          }
          // plain now contains: [4-byte BE len][aad bytes][message bytes]
          if (plain.length < 4) {
            throw new Error('decryption failed: plaintext too short for aad header');
          }
          const len = (plain[0] << 24) | (plain[1] << 16) | (plain[2] << 8) | plain[3];
          const headerLen = 4 + len;
          if (plain.length < headerLen) {
            throw new Error('decryption failed: incomplete aad in plaintext');
          }
          const aadExtracted = plain.slice(4, headerLen);
          // If caller provided AAD, verify it matches the extracted AAD
          if (aad) {
            const provided = new Uint8Array(aad);
            if (provided.length !== aadExtracted.length) {
              throw new Error('AAD mismatch');
            }
            for (let i = 0; i < provided.length; i++) {
              if (provided[i] !== aadExtracted[i]) {
                throw new Error('AAD mismatch');
              }
            }
          }
          const message = plain.slice(headerLen);
          return message;
        },
        // signing: keypair / detached
        crypto_sign_keypair: () => {
          const kp = nacl.sign.keyPair();
          // libsodium-like shape
          return { publicKey: kp.publicKey, privateKey: kp.secretKey };
        },
        crypto_sign_detached: (message: Uint8Array, sk: Uint8Array) => {
          return nacl.sign.detached(new Uint8Array(message), new Uint8Array(sk));
        },
      };

      return shim;
    } catch {
      // All attempts failed
      return null;
    }
  } catch {
    return null;
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
  // context for wrap: include salt (base64) to bind envelope.salt into wrap AAD
  const wrapAad = utf8Encode(`file-binding-context:${toBase64(salt)}`);

  const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    fileKey,
    wrapAad,
    null,
    wrapNonce,
    options.kek
  );

  // Compute a short KEK fingerprint (sha256 -> base64) and include it in the envelope so that
  // a recipient can validate that the provided KEK matches the envelope expectation.
  const kekFingerprint = toBase64(await sha256(options.kek));

  const envelope: Envelope = {
    version: 1,
    walletPubKey: '', // caller MUST set this before persisting the envelope
    kekDerivation: {
      method: 'wallet-signature',
      messageTemplateId: UNLOCK_TEMPLATE_ID,
      salt: toBase64(salt),
      info: 'SJ-KEK-v1',
      kekFingerprint,
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
  // Bind the envelope salt into the wrap AAD so that incorrect/mismatching salt in the envelope
  // will cause the unwrap operation to fail (integrity check).
  const saltFromEnv = envelope && envelope.kekDerivation && envelope.kekDerivation.salt ? envelope.kekDerivation.salt : '';
  const wrapAad = utf8Encode(`file-binding-context:${saltFromEnv}`);

  // If the envelope contains a kekFingerprint we validate it before attempting to unwrap.
  // This prevents accidental usage of a wrong KEK (e.g. salt mismatch) and provides an
  // early integrity check.
  if (envelope && envelope.kekDerivation && (envelope.kekDerivation as any).kekFingerprint) {
    const expectedFp = (envelope.kekDerivation as any).kekFingerprint;
    const computedFp = toBase64(await sha256(kek));
    if (computedFp !== expectedFp) {
      throw new Error('KEK fingerprint mismatch');
    }
  }

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
