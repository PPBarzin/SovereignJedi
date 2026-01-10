// Types and small utilities for wallet identity (Task 03 — Wallet Connection)
//
// Responsibilities:
// - Type definitions for the persisted identity object.
// - Utilities to build the proof message, compute TTL/expiry, and check verification state.
// - Minimal localStorage helpers to persist/load/clear identity and last wallet provider.
//
// Note: This file is intentionally dependency-free and uses browser APIs (crypto, localStorage).
// It is safe to import from React components (guards included for SSR).

/**
 * Wallet provider identifier (MVP supports 'phantom').
 * Keep open to allow string extension for future wallets.
 */
export type WalletProvider = 'phantom' | string;

/**
 * The Identity object persisted to localStorage under `sj_identity`.
 * Matches the Task 3 spec:
 *  - publicKey: base58 string
 *  - message: the full signed message (plain text)
 *  - signature: base58 or hex representation of the signature
 *  - issuedAt: ISO timestamp used inside the message
 *  - verifiedAt: ISO timestamp when verification completed
 *  - expiresAt: ISO timestamp when the proof becomes invalid
 *  - nonce: random string used inside the message
 *  - cluster: solana cluster used (eg "devnet")
 *  - domain: the domain used when building the message
 */
export interface Identity {
  publicKey: string;
  message: string;
  signature: string;
  issuedAt: string; // ISO
  verifiedAt: string; // ISO
  expiresAt: string; // ISO
  nonce: string;
  cluster: string;
  domain: string;
}

/**
 * Minimal shape stored in localStorage for quick checks.
 * Kept identical to Identity for simplicity; exported for potential future extension.
 */
export type IdentityStorage = Identity;

/**
 * State machine for identity/wallet connection.
 */
export enum IdentityState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTED_UNVERIFIED = 'CONNECTED_UNVERIFIED',
  CONNECTED_VERIFIED = 'CONNECTED_VERIFIED',
  ERROR = 'ERROR',
}

/**
 * Local storage keys (explicit constants to avoid typos).
 */
export const STORAGE_KEY_IDENTITY = 'sj_identity';
export const STORAGE_KEY_LAST_PROVIDER = 'sj_lastWalletProvider';

/**
 * Default proof TTL in seconds (24h).
 * Can be overridden at build/runtime via:
 *  - internal: PROOF_TTL_SECONDS
 *  - exposed to client: NEXT_PUBLIC_PROOF_TTL_SECONDS
 */
export const DEFAULT_PROOF_TTL_SECONDS = 24 * 60 * 60; // 86400

/**
 * Returns the configured proof TTL in seconds.
 * Preference order:
 *  - process.env.NEXT_PUBLIC_PROOF_TTL_SECONDS (client-exposed)
 *  - process.env.PROOF_TTL_SECONDS (internal)
 *  - DEFAULT_PROOF_TTL_SECONDS
 *
 * Note: When called in the browser, `process.env.*` is replaced at build time by Next.js.
 */
export function getProofTtlSeconds(): number {
  const fromPublic =
    typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_PROOF_TTL_SECONDS;
  const fromInternal = typeof process !== 'undefined' && process.env && process.env.PROOF_TTL_SECONDS;
  const raw = fromPublic ?? fromInternal ?? undefined;
  if (raw !== undefined) {
    const n = Number(raw);
    if (!Number.isNaN(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_PROOF_TTL_SECONDS;
}

/**
 * Helper to generate a cryptographically strong random nonce of at least 16 bytes,
 * returned as hex. Falls back to Math.random if crypto unavailable.
 */
export function generateNonce(bytes = 24): string {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint8Array(bytes);
      window.crypto.getRandomValues(arr);
      return Array.from(arr)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // fallthrough
  }
  // Fallback (insecure)
  const fallback = Array.from({ length: bytes }, () => Math.floor(Math.random() * 256));
  return fallback.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a stable, human-readable proof message to be signed by the wallet.
 * The format matches Task 3 specification and is intentionally deterministic.
 *
 * Example output:
 * Sovereign Jedi — Proof of Control
 * domain: localhost:1620
 * publicKey: 3N4...AbC
 * statement: Prove you control this wallet for Sovereign Jedi
 * nonce: 4b8f6a9c8f3e...
 * issuedAt: 2026-01-10T09:00:00Z
 * chain: solana:devnet
 * purpose: proof_of_control
 */
export function buildProofMessage(params: {
  domain: string;
  publicKey: string;
  nonce: string;
  issuedAt: string; // ISO
  cluster: string; // e.g. 'devnet'
  statement?: string;
}): string {
  const statement = params.statement ?? 'Prove you control this wallet for Sovereign Jedi';
  const lines = [
    'Sovereign Jedi — Proof of Control',
    `domain: ${params.domain}`,
    `publicKey: ${params.publicKey}`,
    `statement: ${statement}`,
    `nonce: ${params.nonce}`,
    `issuedAt: ${params.issuedAt}`,
    `chain: solana:${params.cluster}`,
    `purpose: proof_of_control`,
  ];
  return lines.join('\n');
}

/**
 * Compute expiresAt ISO string given a verifiedAt ISO and TTL in seconds.
 */
export function computeExpiresAt(verifiedAtIso: string, ttlSeconds?: number): string {
  const base = new Date(verifiedAtIso).getTime();
  const ttl = typeof ttlSeconds === 'number' ? ttlSeconds : getProofTtlSeconds();
  const expires = new Date(base + ttl * 1000);
  return expires.toISOString();
}

/**
 * Check if an identity is expired (now > expiresAt).
 * If identity is falsy or malformed, returns true (treated as expired/missing).
 */
export function isIdentityExpired(identity?: Identity | null, now: Date = new Date()): boolean {
  if (!identity || !identity.expiresAt) return true;
  const expires = Date.parse(identity.expiresAt);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}

/**
 * Quick check whether identity is currently verified.
 */
export function isVerified(identity?: Identity | null, now: Date = new Date()): boolean {
  if (!identity) return false;
  if (!identity.verifiedAt || !identity.expiresAt) return false;
  return !isIdentityExpired(identity, now);
}

/**
 * Small UX helper: truncate address for display (e.g. "ABCD...WXYZ").
 */
export function truncateAddress(addr: string | null | undefined, start = 4, end = 4): string {
  if (!addr) return '';
  if (addr.length <= start + end + 3) return addr;
  const a = addr.slice(0, start);
  const b = addr.slice(addr.length - end);
  return `${a}...${b}`;
}

/**
 * Local storage helpers
 */

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Load identity from localStorage (returns null if not present or invalid).
 */
export function loadIdentity(): Identity | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY_IDENTITY);
  const parsed = safeJsonParse<Identity>(raw);
  // Quick shape check
  if (
    parsed &&
    typeof parsed.publicKey === 'string' &&
    typeof parsed.message === 'string' &&
    typeof parsed.signature === 'string' &&
    typeof parsed.issuedAt === 'string' &&
    typeof parsed.verifiedAt === 'string' &&
    typeof parsed.expiresAt === 'string' &&
    typeof parsed.nonce === 'string' &&
    typeof parsed.cluster === 'string' &&
    typeof parsed.domain === 'string'
  ) {
    return parsed;
  }
  return null;
}

/**
 * Persist identity to localStorage (overwrites).
 * Caller must ensure identity contents are correct (issuedAt/verifiedAt/expiresAt ISO strings).
 */
export function saveIdentity(identity: Identity): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_IDENTITY, JSON.stringify(identity));
  } catch {
    // ignore quota errors — calling code should handle/report UX errors
  }
}

/**
 * Clear identity from localStorage.
 */
export function clearIdentity(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_IDENTITY);
  } catch {
    // ignore
  }
}

/**
 * Last wallet provider helpers
 */
export function getLastWalletProvider(): string | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY_LAST_PROVIDER);
}

export function setLastWalletProvider(provider: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_LAST_PROVIDER, provider);
  } catch {
    // ignore
  }
}

export function clearLastWalletProvider(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_LAST_PROVIDER);
  } catch {
    // ignore
  }
}
