/**
 * Wallet utils for Task 03 — Wallet connection (Solana)
 *
 * Responsibilities:
 * - Verify an ed25519 signature (as produced by Phantom / Solana wallets) for a plain-text message.
 * - Helpers to decode/encode signatures (support base58, base64, hex, Uint8Array).
 *
 * Notes:
 * - Phantom's `signMessage` typically returns a `Uint8Array` (signature bytes).
 * - We persist signatures as text (base58 or base64). This module accepts both.
 * - Verification uses `tweetnacl` (ed25519) and `@solana/web3.js` `PublicKey` to obtain the publicKey bytes.
 *
 * Be defensive: functions return explicit booleans and throw only on truly exceptional inputs.
 */

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

/**
 * Acceptable signature length for ed25519
 */
const ED25519_SIG_LEN = 64;

/**
 * Convert an input (string or Uint8Array) into a Uint8Array representing the signature bytes.
 * Supported string encodings:
 *  - base58 (preferred for Solana)
 *  - base64
 *  - hex
 *
 * Returns Uint8Array on success or throws Error on unsupported/malformed input.
 */
export function decodeSignature(
  sig: string | Uint8Array
): Uint8Array {
  if (sig instanceof Uint8Array) {
    if (sig.length !== ED25519_SIG_LEN) {
      throw new Error(`Invalid signature length: ${sig.length} (expected ${ED25519_SIG_LEN})`);
    }
    return sig;
  }

  if (typeof sig !== 'string') {
    throw new Error('Signature must be a string or Uint8Array');
  }

  // Try base58 decode first (common for Solana).
  try {
    const decoded = bs58.decode(sig);
    if (decoded.length === ED25519_SIG_LEN) return new Uint8Array(decoded);
    // If decoded length unexpected, continue to other formats
  } catch {
    // ignore and try next
  }

  // Try base64
  try {
    const buf = Buffer.from(sig, 'base64');
    if (buf.length === ED25519_SIG_LEN) return new Uint8Array(buf);
  } catch {
    // ignore
  }

  // Try hex
  const hexRegex = /^[0-9a-fA-F]+$/;
  if (hexRegex.test(sig) && sig.length === ED25519_SIG_LEN * 2) {
    return new Uint8Array(Buffer.from(sig, 'hex'));
  }

  throw new Error('Unable to decode signature: unsupported format or invalid length');
}

/**
 * Convert a signature (Uint8Array or string) into a base58 string.
 * Useful for storing/displaying signatures consistently.
 *
 * If input is a string, attempts to decode it first (supporting base58/base64/hex).
 */
export function signatureToBase58(sig: string | Uint8Array): string {
  const bytes = decodeSignature(sig);
  return bs58.encode(Buffer.from(bytes));
}

/**
 * Convert message input to Uint8Array for verification.
 * Accepts string (UTF-8) or Uint8Array.
 */
export function messageToBytes(message: string | Uint8Array): Uint8Array {
  if (message instanceof Uint8Array) return message;
  if (typeof message === 'string') {
    return new TextEncoder().encode(message);
  }
  throw new Error('Message must be a string or Uint8Array');
}

/**
 * Verify that a signature corresponds to a plain-text message signed by the given publicKey.
 *
 * Parameters:
 *  - message: string | Uint8Array (the exact text that was signed)
 *  - signature: string | Uint8Array (base58/base64/hex or raw bytes)
 *  - publicKeyStr: base58-encoded Solana public key (string)
 *
 * Returns:
 *  - true if signature is valid, false otherwise
 *
 * Does not mutate inputs. Throws only on malformed inputs.
 */
export function verifyMessageSignature(
  message: string | Uint8Array,
  signature: string | Uint8Array,
  publicKeyStr: string
): boolean {
  // Normalize inputs
  const messageBytes = messageToBytes(message);
  const sigBytes = decodeSignature(signature);

  // Obtain publicKey bytes via @solana/web3.js PublicKey helper
  let pubKeyBytes: Uint8Array;
  try {
    const pub = new PublicKey(publicKeyStr);
    // PublicKey.toBytes() returns a Uint8Array
    pubKeyBytes = pub.toBytes();
  } catch (err) {
    // invalid publicKey string
    throw new Error('Invalid publicKey string provided');
  }

  if (pubKeyBytes.length !== 32) {
    throw new Error(`Invalid publicKey byte length: ${pubKeyBytes.length} (expected 32)`);
  }

  // Use tweetnacl to verify detached signature
  try {
    return nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Utility: verify signature but return richer result (for logging/UI).
 */
export function verifyMessageSignatureVerbose(
  message: string | Uint8Array,
  signature: string | Uint8Array,
  publicKeyStr: string
): { ok: boolean; reason?: string } {
  try {
    if (!message || (typeof message === 'string' && message.length === 0))
      return { ok: false, reason: 'empty_message' };

    if (!signature) return { ok: false, reason: 'empty_signature' };
    if (!publicKeyStr) return { ok: false, reason: 'empty_public_key' };

    // Decode signature (will throw on malformed)
    let sigBytes: Uint8Array;
    try {
      sigBytes = decodeSignature(signature);
    } catch (e) {
      return { ok: false, reason: 'invalid_signature_encoding' };
    }

    // Message bytes
    let messageBytes: Uint8Array;
    try {
      messageBytes = messageToBytes(message);
    } catch (e) {
      return { ok: false, reason: 'invalid_message' };
    }

    // Public key
    let pubKeyBytes: Uint8Array;
    try {
      const pub = new PublicKey(publicKeyStr);
      pubKeyBytes = pub.toBytes();
    } catch {
      return { ok: false, reason: 'invalid_public_key' };
    }

    // Verify
    const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
    if (!valid) return { ok: false, reason: 'signature_mismatch' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'internal_error' };
  }
}
