/**
 * Shared crypto utilities for @sj/crypto
 *
 * Exports:
 * - utf8Encode(input: string): Uint8Array
 * - utf8Decode(input: Uint8Array | ArrayBuffer): string
 * - toHex(bytes): string
 * - fromHex(hex): Uint8Array
 * - cryptoGetRandomBytes(len = 32): Uint8Array
 * - sha256(data): Promise<Uint8Array>
 * - deriveKeyHKDF(ikm, salt?, info?, length?): Promise<Uint8Array>
 *
 * Implementation notes:
 * - Uses Web Crypto (SubtleCrypto) when available.
 * - Falls back to Node's crypto.randomBytes for randomness when necessary.
 * - HKDF implemented using HMAC-SHA256 (extract + expand).
 *
 * This file is intentionally self-contained to be importable by other modules
 * without causing circular dependencies.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* -------------------------
 * Runtime helpers
 * ------------------------- */

function getSubtle(): SubtleCrypto {
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && (globalThis as any).crypto.subtle) {
    return (globalThis as any).crypto.subtle as SubtleCrypto;
  }
  // If SubtleCrypto is not available, we intentionally throw.
  throw new Error('SubtleCrypto API is not available in this environment. Ensure Node >=18 or a browser with Web Crypto support.');
}

/* -------------------------
 * Encoding helpers
 * ------------------------- */

export function utf8Encode(input: string): Uint8Array {
  return encoder.encode(input);
}

export function utf8Decode(input: Uint8Array | ArrayBuffer): string {
  return decoder.decode(input instanceof Uint8Array ? input : new Uint8Array(input));
}

/* -------------------------
 * Hex helpers
 * ------------------------- */

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

/* -------------------------
 * Randomness
 * ------------------------- */

export function cryptoGetRandomBytes(len = 32): Uint8Array {
  // Prefer Web Crypto
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && typeof (globalThis as any).crypto.getRandomValues === 'function') {
    return (globalThis as any).crypto.getRandomValues(new Uint8Array(len));
  }

  // Try Node.js crypto if available
  try {
    // Use indirect require to avoid bundlers picking up Node-only require in browser builds.
    // This code path will only be executed in Node environments.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const maybeReq = Function('return require')();
    const nodeCrypto = typeof maybeReq === 'function' ? maybeReq('crypto') : undefined;
    if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
      const buf = nodeCrypto.randomBytes(len);
      // Ensure we return a Uint8Array backed by a plain ArrayBuffer
      return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
  } catch {
    // ignore and fallthrough
  }

  throw new Error('No secure random source available');
}

/* -------------------------
 * Hash (SHA-256)
 * ------------------------- */

export async function sha256(data: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const subtle = getSubtle() as any;
  const inputView = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
  const digest = await subtle.digest('SHA-256', inputView.buffer as ArrayBuffer);
  return new Uint8Array(digest as ArrayBuffer).slice();
}

/* -------------------------
 * HMAC-SHA256 helper (for HKDF)
 * ------------------------- */

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle() as any;
  // Import HMAC key
  const keyBuf = new Uint8Array(keyBytes).buffer as ArrayBuffer;
  const imported = await subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('HMAC', imported, new Uint8Array(data).buffer as ArrayBuffer);
  return new Uint8Array(sig as ArrayBuffer).slice();
}

/* -------------------------
 * HKDF (RFC 5869) — extract + expand
 * ------------------------- */

/**
 * Normalize salt for HKDF-Extract: if salt is null/empty, use zeros of hashLen.
 */
function normalizeSalt(salt: Uint8Array | null, hashLen = 32): Uint8Array {
  if (!salt || salt.length === 0) {
    return new Uint8Array(hashLen);
  }
  return salt;
}

export async function hkdfExtract(salt: Uint8Array | null, ikm: Uint8Array): Promise<Uint8Array> {
  const normalizedSalt = normalizeSalt(salt, 32); // SHA-256 hash len = 32
  return hmacSha256(normalizedSalt, ikm);
}

export async function hkdfExpand(prk: Uint8Array, info: Uint8Array | null, length: number): Promise<Uint8Array> {
  if (length <= 0 || length > 255 * 32) {
    throw new Error('hkdfExpand: invalid length');
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
    t = (await hmacSha256(prk, input)).slice();
    okmParts.push(t);
  }

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
 * Exports (already done via named exports)
 * ------------------------- */

export default {
  utf8Encode,
  utf8Decode,
  toHex,
  fromHex,
  cryptoGetRandomBytes,
  sha256,
  deriveKeyHKDF,
  hkdfExtract,
  hkdfExpand,
};
