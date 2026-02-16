/**
 * @package @sj/crypto
 * Cryptographic primitives for Sovereign Jedi (Episode I: The awakening).
 *
 * Exports:
 * - deriveKeyHKDF(ikm, salt, info, length) -> Uint8Array
 * - generateAesKey() -> Promise<CryptoKey>
 * - importAesKey(raw) -> Promise<CryptoKey>
 * - exportAesKey(key) -> Promise<Uint8Array>
 * - encryptAesGcm(key, plaintext, iv?) -> Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>
 * - decryptAesGcm(key, iv, ciphertext) -> Promise<Uint8Array>
 * - sha256(data) -> Promise<Uint8Array>
 * - utils: toHex, fromHex, utf8Encode, utf8Decode
 *
 * NOTE: This module uses the Web Crypto API (SubtleCrypto). Node.js >=18 provides a compatible webcrypto implementation.
 * If SubtleCrypto is not available in the environment, functions will throw an informative error.
 *
 * Implementation details:
 * - HKDF is implemented (RFC 5869) using HMAC-SHA256 via SubtleCrypto (extract + expand).
 * - AES-GCM (256-bit) for symmetric encryption.
 *
 * The functions are written in portable TypeScript and avoid any runtime side-effects.
 */

/* Task 4 public API wrappers — dynamic import to avoid circular runtime import and prevent
   circular module initialization at package entrypoint.

   Exports (named):
   - prepareUnlock
   - buildUnlockMessageV1
   - assertUnlockNotExpired
   - deriveKekFromUnlockSignature (ONLY public KEK derivation API; enforces OQ-06 expiry refusal)
   - encryptFile
   - decryptFile

   Notes:
   - These wrappers dynamically import the implementation in `src/v0_local_encryption/localEncryption`
     at call time so the package entrypoint does not create a circular runtime dependency.
   - Types are re-exported as type-only exports from `src/v0_local_encryption/types` so TypeScript
     consumers can import the shapes without introducing runtime imports.
   - The implementation enforces libsodium-only; the browser integration is expected to provide
     `globalThis.sodium` or otherwise make `libsodium-wrappers-sumo` available at runtime. If absent,
     the underlying implementation will fail hard (throw).
*/
export type { EncryptedFile, Envelope, UnlockMessageV1, BuildUnlockResult } from './v0_local_encryption/types';

/**
 * Dynamic wrappers that forward calls to the implementation module.
 * These are async to allow dynamic import without creating circular imports.
 */
export async function buildUnlockMessageV1(params: {
  origin?: string;
  wallet: string;
  vaultId?: string;
  nonceBytes?: Uint8Array;
  issuedAt?: string;
  expiresAt?: string;
}): Promise<BuildUnlockResult> {
  const mod = await import('./v0_local_encryption/localEncryption');
  return mod.buildUnlockMessageV1(params);
}

export async function prepareUnlock(params: {
  origin?: string;
  wallet: string;
  vaultId?: string;
  saltBytes?: Uint8Array;
}): Promise<{ salt: Uint8Array; unlock: BuildUnlockResult }> {
  const mod = await import('./v0_local_encryption/localEncryption');
  return mod.prepareUnlock(params);
}

/**
 * assertUnlockNotExpired
 *
 * OQ-06 compliance helper: refuse expired unlock messages before KEK derivation.
 *
 * @param unlock the BuildUnlockResult produced by buildUnlockMessageV1/prepareUnlock
 * @param nowMs current time in milliseconds (default: Date.now())
 *
 * Throws Error("Unlock message expired") when expiresAt <= nowMs.
 */
export function assertUnlockNotExpired(unlock: BuildUnlockResult, nowMs = Date.now()): void {
  const expiresAt = unlock?.canonicalObject?.expiresAt;
  const ts = Date.parse(expiresAt);
  if (!expiresAt || Number.isNaN(ts) || ts <= nowMs) {
    throw new Error("Unlock message expired");
  }
}

/**
 * NOTE (OQ-06 compliance):
 * We intentionally do NOT export `deriveKekFromSignature` publicly.
 * KEK derivation MUST go through `deriveKekFromUnlockSignature`, which enforces expiry refusal.
 *
 * Internal helper used only by the public `deriveKekFromUnlockSignature`.
 */
async function deriveKekFromSignatureInternal(signatureBytes: Uint8Array, saltBytes: Uint8Array | null): Promise<Uint8Array> {
  const mod = await import('./v0_local_encryption/localEncryption');
  return mod.deriveKekFromSignature(signatureBytes, saltBytes);
}

/**
 * deriveKekFromUnlockSignature
 *
 * OQ-06 compliant KEK derivation helper.
 * MUST call assertUnlockNotExpired(unlock) before delegating to deriveKekFromSignature().
 */
export async function deriveKekFromUnlockSignature(params: {
  signatureBytes: Uint8Array;
  saltBytes: Uint8Array | null;
  unlock: BuildUnlockResult;
  nowMs?: number;
}): Promise<Uint8Array> {
  assertUnlockNotExpired(params.unlock, params.nowMs ?? Date.now());
  return deriveKekFromSignatureInternal(params.signatureBytes, params.saltBytes);
}

export async function generateFileKey(): Promise<Uint8Array> {
  const mod = await import('./v0_local_encryption/localEncryption');
  return mod.generateFileKey();
}

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
): Promise<{
  encryptedFile: EncryptedFile;
  envelope: Envelope;
  fileKey?: Uint8Array;
}> {
  const mod = await import('./v0_local_encryption/localEncryption');
  return mod.encryptFile(plaintext, options);
}

export async function decryptFile(encryptedFile: EncryptedFile, envelope: Envelope, kek: Uint8Array): Promise<Uint8Array> {
  const mod = await import('./v0_local_encryption/localEncryption');
  return mod.decryptFile(encryptedFile, envelope, kek);
}

 const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getSubtle(): SubtleCrypto {
  // Prefer global Web Crypto
  if (typeof globalThis !== "undefined" && (globalThis as any).crypto && (globalThis as any).crypto.subtle) {
    return (globalThis as any).crypto.subtle as SubtleCrypto;
  }

  // In many Node.js environments (>=18) `globalThis.crypto.subtle` is available.
  // If it's not, we can't proceed. We intentionally do not attempt dynamic imports here
  // to keep the code simple and environment-agnostic.
  throw new Error(
    "SubtleCrypto API is not available in this environment. Ensure you run Node >=18 or a browser with Web Crypto support."
  );
}

/* -------------------------
 * Utility helpers
 * ------------------------- */

export function utf8Encode(input: string): Uint8Array {
  return encoder.encode(input);
}

export function utf8Decode(input: Uint8Array | ArrayBuffer): string {
  return decoder.decode(input instanceof Uint8Array ? input : new Uint8Array(input));
}

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/* -------------------------
 * Low-level primitives
 * ------------------------- */

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Cast subtle to any to avoid TypeScript overload mismatches across environments
  const subtle = getSubtle() as any;
  // Ensure we pass plain ArrayBuffer-backed copies into SubtleCrypto to avoid SharedArrayBuffer typing issues
  const keyBuf = new Uint8Array(keyBytes).buffer as ArrayBuffer;
  const dataBuf = new Uint8Array(data).buffer as ArrayBuffer;
  const key = await (subtle.importKey as any)(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await (subtle.sign as any)("HMAC", key, dataBuf);
  // Ensure we return a Uint8Array backed by a plain ArrayBuffer by copying the result
  return new Uint8Array(sig as ArrayBuffer).slice();
}

export async function sha256(data: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const subtle = getSubtle() as any;
  // Normalize to a plain ArrayBuffer-backed Uint8Array copy to avoid SharedArrayBuffer typing
  const inputView = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
  const buffer = inputView.buffer as ArrayBuffer;
  const digest = await (subtle.digest as any)("SHA-256", buffer);
  return new Uint8Array(digest as ArrayBuffer).slice();
}

/* -------------------------
 * HKDF (RFC 5869) — extract + expand
 * ------------------------- */

/**
 * HKDF-Extract: PRK = HMAC(salt, IKM)
 * If salt is empty, it is replaced with a zero-filled array of HashLen.
 */
function normalizeSalt(salt: Uint8Array | null, hashLen = 32): Uint8Array {
  if (!salt || salt.length === 0) {
    return new Uint8Array(hashLen);
  }
  return salt;
}

/**
 * hkdfExtract
 * @param salt Uint8Array | null
 * @param ikm Uint8Array
 * @returns PRK (pseudo-random key) as Uint8Array
 */
export async function hkdfExtract(salt: Uint8Array | null, ikm: Uint8Array): Promise<Uint8Array> {
  const normalizedSalt = normalizeSalt(salt, 32); // SHA-256 hash len = 32
  return hmacSha256(normalizedSalt, ikm);
}

/**
 * hkdfExpand
 * @param prk pseudo-random key (Uint8Array)
 * @param info optional context (Uint8Array)
 * @param length length in bytes of output keying material
 */
export async function hkdfExpand(prk: Uint8Array, info: Uint8Array | null, length: number): Promise<Uint8Array> {
  if (length <= 0 || length > 255 * 32) {
    throw new Error("hkdfExpand: invalid length");
  }

  const hashLen = 32; // SHA-256
  const n = Math.ceil(length / hashLen);
  let t = new Uint8Array(0);
  const okmParts: Uint8Array[] = [];

  for (let i = 1; i <= n; i++) {
    // input = T(i-1) || info || 0x(i)
    const input = new Uint8Array(t.length + (info ? info.length : 0) + 1);
    input.set(t, 0);
    if (info) input.set(info, t.length);
    input[t.length + (info ? info.length : 0)] = i;
    // Ensure we copy the derived block into a plain ArrayBuffer-backed Uint8Array
    // to avoid ArrayBufferLike/SharedArrayBuffer typing leaking into callers.
    t = (await hmacSha256(prk, input)).slice();
    okmParts.push(t);
  }

  // concatenate and slice to requested length
  const okm = new Uint8Array(n * hashLen);
  let offset = 0;
  for (const part of okmParts) {
    okm.set(part, offset);
    offset += part.length;
  }

  return okm.slice(0, length);
}

/**
 * deriveKeyHKDF
 * Helper that performs HKDF extract+expand and returns the derived bytes.
 *
 * @param ikm input keying material (Uint8Array)
 * @param salt optional salt (Uint8Array | null)
 * @param info optional context (Uint8Array | null)
 * @param length desired output length in bytes (default 32)
 */
export async function deriveKeyHKDF(
  ikm: Uint8Array,
  salt: Uint8Array | null = null,
  info: Uint8Array | null = null,
  length = 32
): Promise<Uint8Array> {
  const prk = await hkdfExtract(salt, ikm);
  const okm = await hkdfExpand(prk, info, length);
  return okm;
}

/* -------------------------
 * AES-GCM helpers
 * ------------------------- */

export async function generateAesKey(): Promise<CryptoKey> {
  const subtle = getSubtle();
  // generate AES-GCM 256-bit key
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle() as any;
  // Ensure we pass a plain ArrayBuffer-backed copy to SubtleCrypto to avoid SharedArrayBuffer typing
  const rawBuf = new Uint8Array(raw).buffer as ArrayBuffer;
  return (subtle.importKey as any)("raw", rawBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function exportAesKey(key: CryptoKey): Promise<Uint8Array> {
  const subtle = getSubtle() as any;
  const raw = await (subtle.exportKey as any)("raw", key);
  // Copy to ensure the returned view is backed by a plain ArrayBuffer
  return new Uint8Array(raw as ArrayBuffer).slice();
}

/**
 * Encrypt plaintext (Uint8Array) with AES-GCM using provided CryptoKey.
 * If iv is not provided, a random 12-byte IV is generated.
 *
 * Returns { iv, ciphertext } where both are Uint8Array.
 */
export async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array,
  iv?: Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const subtle = getSubtle() as any;
  const usedIv = iv ?? cryptoGetRandomBytes(12);
  // Ensure plaintext is a plain ArrayBuffer-backed copy before passing to SubtleCrypto
  const ptBuf = new Uint8Array(plaintext).buffer as ArrayBuffer;
  const ct = await (subtle.encrypt as any)({ name: "AES-GCM", iv: usedIv }, key, ptBuf);
  return { iv: usedIv, ciphertext: new Uint8Array(ct as ArrayBuffer).slice() };
}

/**
 * Decrypt AES-GCM ciphertext (Uint8Array) with provided CryptoKey and IV.
 * Returns plaintext as Uint8Array.
 */
export async function decryptAesGcm(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle() as any;
  // Ensure ciphertext is a plain ArrayBuffer-backed copy before passing to SubtleCrypto
  const ctBuf = new Uint8Array(ciphertext).buffer as ArrayBuffer;
  const plain = await (subtle.decrypt as any)({ name: "AES-GCM", iv }, key, ctBuf);
  return new Uint8Array(plain as ArrayBuffer).slice();
}

/* -------------------------
 * Misc helpers
 * ------------------------- */

export function cryptoGetRandomBytes(len = 32): Uint8Array {
  // Try Web Crypto first (browser / Node >= 18)
  if (typeof globalThis !== "undefined" && (globalThis as any).crypto && typeof (globalThis as any).crypto.getRandomValues === "function") {
    // getRandomValues writes into the provided typed array and returns it.
    return (globalThis as any).crypto.getRandomValues(new Uint8Array(len)) as Uint8Array;
  }

  // Fallback: try Node.js crypto module if available (use Buffer then convert)
  try {
    // Dynamic access to Node's `require` without referencing it directly so bundlers
    // don't inline `require` into browser bundles and ESLint `no-var-requires` is not triggered.
    let nodeCrypto: any | undefined;
    if (typeof process !== 'undefined' && typeof process.versions !== 'undefined' && process.versions.node) {
      // Use an indirect Function call to obtain `require` at runtime in Node only.
      // This avoids a direct `require('crypto')` call that could be processed by bundlers.
      const maybeReq = Function('return require')();
      nodeCrypto = typeof maybeReq === 'function' ? maybeReq('crypto') : undefined;
    }
    if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
      // Buffer -> Uint8Array conversion ensures we return a real Uint8Array backed by an ArrayBuffer
      const buf = nodeCrypto.randomBytes(len);
      return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
  } catch {
    // ignore and fallthrough to error
  }

  throw new Error("No secure random source available");
}

/* -------------------------
 * Convenience wrappers: encrypt/decrypt with raw symmetric key bytes
 * ------------------------- */

/**
 * Convenience: encrypt using raw AES key bytes (Uint8Array).
 * The rawKey is imported into a CryptoKey (temporary) and used for encryption.
 */
export async function encryptAesGcmWithRawKey(
  rawKey: Uint8Array,
  plaintext: Uint8Array,
  iv?: Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const key = await importAesKey(rawKey);
  return encryptAesGcm(key, plaintext, iv);
}

/**
 * Convenience: decrypt using raw AES key bytes (Uint8Array).
 */
export async function decryptAesGcmWithRawKey(
  rawKey: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesKey(rawKey);
  return decryptAesGcm(key, iv, ciphertext);
}

/* -------------------------
 * Self-test helper (handy for quick local checks)
 * ------------------------- */

/**
 * runSelfTest
 * Performs a small roundtrip test to verify core functions (HKDF + AES-GCM).
 *
 * Returns an object with useful debug info but DOES NOT throw on success.
 */
export async function runSelfTest(): Promise<{
  hkdfDerivedHex: string;
  encryptedHex: string;
  decryptedText: string;
}> {
  // sample inputs
  const ikm = utf8Encode("seed-material");
  const salt = utf8Encode("somesalt");
  const info = utf8Encode("sj:episode1:v1");

  // deriveKeyHKDF returns a Uint8Array, but we normalize/copy to ensure
  // the returned buffer is a plain ArrayBuffer-backed Uint8Array (avoid SharedArrayBuffer typing issues).
  const derivedRaw = await deriveKeyHKDF(ikm, salt, info, 32);
  // Create a new Uint8Array from the derived bytes to ensure a plain ArrayBuffer-backed view
  const derived = new Uint8Array(derivedRaw);
  const hkdfDerivedHex = toHex(derived)

  // use derived as AES raw key (explicitly pass a proper Uint8Array)
  const plaintext = utf8Encode("hello sovereign jedi");
  const { iv, ciphertext } = await encryptAesGcmWithRawKey(derived, plaintext);
  const encryptedHex = toHex(ciphertext);

  const decrypted = await decryptAesGcmWithRawKey(derived, iv, ciphertext);
  const decryptedText = utf8Decode(decrypted);

  return { hkdfDerivedHex, encryptedHex, decryptedText };
}

/* -------------------------
 * Exports
 * ------------------------- */

export default {
  // hkdf
  hkdfExtract,
  hkdfExpand,
  deriveKeyHKDF,
  // AES helpers
  generateAesKey,
  importAesKey,
  exportAesKey,
  encryptAesGcm,
  decryptAesGcm,
  encryptAesGcmWithRawKey,
  decryptAesGcmWithRawKey,
  // hash
  sha256,
  // utils
  toHex,
  fromHex,
  utf8Encode,
  utf8Decode,
  cryptoGetRandomBytes,
  // self-test
  runSelfTest,
};
