/**
 * SessionManager for Sovereign Jedi — Task 3.5
 *
 * Responsibilities:
 * - Expose the contract API required by Task 3.5:
 *   connectWallet(), unlockVault(), lockVault(), isWalletConnected(), isVaultUnlocked()
 * - Keep `VaultUnlocked` strictly in-memory (lost on refresh / tab close)
 * - Persist a non-sensitive `Verified` signal in localStorage with a TTL (default 24h)
 *   containing only non-secret metadata (walletPubKey, verifiedAt, expiresAt, optional provider)
 *
 * Task 6 (Manifest v1) requirements (MVP decisions):
 * - Keep 3 separate roots:
 *   1) Proof-of-control / Verify: UX gating only (may remain message-maison), MUST NOT be used for KEK derivation
 *   2) Unlock Vault (SJ_UNLOCK_V1): volatile, TTL-enforced (OQ-06), session gating only
 *   3) Vault Root (SJ_VAULT_ROOT_V1): stable, re-signable after refresh, ONLY root used to derive stable KEK for manifest
 *
 * Security invariants:
 * - No secrets persisted (no KEK, no root signature, no private keys). Vault Root + Unlock materials are memory-only.
 *
 * UX / Wallet integration note (Phantom popup flicker):
 * - When available, we prefer signing via the Solana wallet-adapter (injected via `setWalletAdapterSigner()`),
 *   because it tends to integrate better with the provider lifecycle and avoids popup flicker/races.
 * - We keep a fallback to window.solana for environments where wallet-adapter is not available.
 *
 * Debugging (MVP):
 * - Under NEXT_PUBLIC_SJ_DEBUG=true, we log sha256(messageToSign) for unlock and vault-root messages.
 *   We never log the raw messageToSign or the signature bytes.
 *
 * Testability:
 * - `unlockVault()` supports injecting a custom unlock builder (test-only) via `setUnlockBuilderForTests()`.
 * - Vault root message builder can be injected via `setVaultRootBuilderForTests()` (test-only).
 */

import * as nacl from "tweetnacl";
import bs58 from "bs58";
import type { BuildUnlockResult, BuildVaultRootResult } from "@sj/crypto";
import {
  buildUnlockMessageV1,
  deriveKekFromUnlockSignature,
  cryptoGetRandomBytes,
  sha256,
  buildVaultRootMessageV1,
} from "@sj/crypto";

export const MESSAGE_TO_SIGN = `SOVEREIGN_JEDI_UNLOCK_VAULT_V1
Cette signature déverrouille temporairement votre coffre pour la session en cours.`;

// Internal prefix used to build per-call messages (includes nonce/issuedAt).
export const MESSAGE_PREFIX = `SOVEREIGN_JEDI_UNLOCK_V2`;

// localStorage key for the non-sensitive verified signal (legacy name for compatibility)
const VERIFIED_STORAGE_KEY = "sj_verified_v1";

// Default TTL for Verified signal (24 hours)
const DEFAULT_VERIFIED_TTL_MS = 24 * 60 * 60 * 1000;

export type VerifiedState = {
  walletPubKey: string; // base58 string
  verifiedAt: number; // epoch ms
  expiresAt: number; // epoch ms
  walletProvider?: string;
  // Per-session metadata to mitigate replay: nonce and issuedAt (ISO)
  nonce?: string;
  issuedAt?: string; // ISO timestamp
};

function nowMs(): number {
  return Date.now();
}

function sjDebugLog(message: string, data?: Record<string, any>): void {
  if (!isSjDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(`[SJ_DEBUG][SessionManager] ${message}`, data ?? {});
  } catch {
    // ignore
  }
}

function shortStackTrace(skipLines = 2, maxLines = 6): string[] {
  try {
    const raw = new Error().stack ?? "";
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.slice(skipLines, skipLines + maxLines);
  } catch {
    return [];
  }
}

function isSjDebugEnabled(): boolean {
  try {
    return String(process.env.NEXT_PUBLIC_SJ_DEBUG).toLowerCase() === "true";
  } catch {
    return false;
  }
}

function buildSessionInstanceId(): string {
  try {
    const c = (globalThis as any)?.crypto;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
  } catch {
    // ignore
  }
  return `sj-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toBase64(bytes: Uint8Array): string {
  // Node
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");

  // Browser fallback
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
  // eslint-disable-next-line no-undef
  return btoa(binary);
}

async function debugLogMessageToSignSha256(tag: string, messageToSign: string): Promise<void> {
  if (!isSjDebugEnabled()) return;
  try {
    const bytes = new TextEncoder().encode(messageToSign);
    const digest = await sha256(bytes);
    const b64 = toBase64(new Uint8Array(digest));
    // IMPORTANT: never log messageToSign or signature; only log the digest for diffing across refresh.
    // eslint-disable-next-line no-console
    console.debug(`[SJ_DEBUG] ${tag} messageToSign sha256B64`, { sha256B64: b64 });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.debug(`[SJ_DEBUG] ${tag} messageToSign sha256B64 (failed)`, { message: e?.message ?? String(e) });
  }
}

/**
 * Convert various inputs to Uint8Array expected by nacl.
 * - If input is a Uint8Array or ArrayLike -> wraps it
 * - If input is a base58 string -> decodes via bs58
 * - If input is a base64 string -> decodes via atob (browser) or Buffer (node)
 */
function toUint8Array(input: Uint8Array | ArrayLike<number> | string): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (typeof input === "string") {
    // Try base58 (Solana-style)
    try {
      return bs58.decode(input);
    } catch (e) {
      // Not base58, try base64
      try {
        // Browser-friendly base64 decode
        if (typeof atob === "function") {
          const binary = atob(input);
          const arr = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            arr[i] = binary.charCodeAt(i);
          }
          return arr;
        }
      } catch {
        // fallback to Node Buffer if available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maybeBuffer = (globalThis as any).Buffer;
        if (maybeBuffer && typeof maybeBuffer.from === "function") {
          return new Uint8Array(maybeBuffer.from(input, "base64"));
        }
      }
      // If all fails, throw
      throw new Error("Unable to decode string into Uint8Array (not base58/base64)");
    }
  }
  // ArrayLike<number>
  return new Uint8Array(input as ArrayLike<number>);
}

/**
 * Safe access to localStorage (guards SSR and test environments where globalThis.localStorage is mocked)
 */
function safeLocalStorage(): Storage | null {
  try {
    // Accept both browser `window.localStorage` and environments that expose
    // `localStorage` on the global object (tests may mock globalThis.localStorage).
    const globalObj: any = (typeof window !== "undefined") ? window : globalThis;
    if (globalObj && globalObj.localStorage) {
      return globalObj.localStorage as Storage;
    }
    return null;
  } catch {
    return null;
  }
}

function loadVerified(): VerifiedState | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(VERIFIED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifiedState;
    if (!parsed || typeof parsed.expiresAt !== "number") {
      ls.removeItem(VERIFIED_STORAGE_KEY);
      return null;
    }
    if (parsed.expiresAt > nowMs()) return parsed;
    // expired
    ls.removeItem(VERIFIED_STORAGE_KEY);
    return null;
  } catch (e) {
    // If anything goes wrong, don't crash the app — treat as not verified
    // eslint-disable-next-line no-console
    console.warn("SessionManager: failed to load verified state", e);
    return null;
  }
}

function saveVerified(v: VerifiedState): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(v));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("SessionManager: failed to save verified state", e);
  }
}

function clearVerified(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(VERIFIED_STORAGE_KEY);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("SessionManager: failed to clear verified state", e);
  }
}

/**
 * SessionManager
 *
 * Exposes the contract API required by Task 3.5.
 * VaultUnlocked is memory-only and lost on refresh.
 */
export class SessionManager {
  public readonly instanceId: string = buildSessionInstanceId();
  private walletPubKey: string | null = null; // base58 string
  private walletProvider: string | null = null;
  private vaultUnlocked = false; // memory-only
  private verified: VerifiedState | null = null;

  /**
   * Task 6 (Manifest v1):
   * In-memory Unlock Vault material for the current tab/session ONLY (SJ_UNLOCK_V1).
   *
   * - lastUnlock: canonical object + messageToSign for SJ_UNLOCK_V1
   * - lastUnlockSignatureBytes: signature bytes returned by the wallet for unlock.messageToSign
   *
   * MUST NOT be persisted.
   */
  private lastUnlock: BuildUnlockResult | null = null;
  private lastUnlockSignatureBytes: Uint8Array | null = null;

  /**
   * Task 6 (Manifest v1):
   * In-memory Vault Root material for the current tab/session ONLY (SJ_VAULT_ROOT_V1).
   *
   * This is the ONLY valid root for stable manifest KEK derivation across refresh.
   *
   * - lastVaultRoot: canonical object + messageToSign for SJ_VAULT_ROOT_V1
   * - lastVaultRootSignatureBytes: signature bytes returned by the wallet for vaultRoot.messageToSign
   *
   * MUST NOT be persisted.
   */
  private lastVaultRoot: BuildVaultRootResult | null = null;
  private lastVaultRootSignatureBytes: Uint8Array | null = null;

  // Optional injected signer for testing or alternative integrations.
  // The signer MUST accept the message bytes and return a signature bytes (Uint8Array).
  private signer?: (message: Uint8Array) => Promise<Uint8Array>;

  /**
   * Optional injected wallet-adapter signer.
   *
   * When present, this takes precedence over window.solana to reduce provider races/popups.
   * It must sign the provided message bytes and return signature bytes.
   */
  private walletAdapterSigner?: (message: Uint8Array) => Promise<Uint8Array>;

  /**
   * Optional injected unlock builder for deterministic tests.
   * Defaults to @sj/crypto.buildUnlockMessageV1.
   *
   * IMPORTANT:
   * - This is NOT persisted.
   * - Production code should use the default.
   */
  private unlockBuilder?: (params: {
    origin?: string;
    wallet: string;
    vaultId?: string;
    nonceBytes?: Uint8Array;
    issuedAt?: string;
    expiresAt?: string;
  }) => Promise<BuildUnlockResult>;

  /**
   * Optional injected vault-root builder for deterministic tests.
   * Defaults to @sj/crypto.buildVaultRootMessageV1.
   *
   * IMPORTANT:
   * - This is NOT persisted.
   * - Production code should use the default.
   */
  private vaultRootBuilder?: (params: {
    origin?: string;
    wallet: string;
    vaultId?: string;
  }) => Promise<BuildVaultRootResult>;

  constructor() {
    // Load persisted non-sensitive verified signal if available.
    this.verified = loadVerified();
    // Enforce Task 3.5 invariant: VaultUnlocked MUST be false on initialization (fresh session).
    this.vaultUnlocked = false;

    if (isSjDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.log("[SJ_DEBUG][Session] NEW instance", {
        instanceId: this.instanceId,
        walletPubKey: this.walletPubKey,
        vaultUnlocked: this.vaultUnlocked,
        stack: new Error().stack?.split("\n").slice(0, 4),
      });
    }
  }

  private logWalletMutation(action: "connect" | "disconnect" | "setWalletPubKey"): void {
    if (!isSjDebugEnabled()) return;
    try {
      // eslint-disable-next-line no-console
      console.log("[SJ_DEBUG][Session]", {
        instanceId: this.instanceId,
        action,
        newValue: this.walletPubKey,
        stack: new Error().stack?.split("\n").slice(0, 4),
      });
    } catch {
      // ignore
    }
  }

  /**
   * provides a different signature API).
   */
  setSigner(fn: (message: Uint8Array) => Promise<Uint8Array>): void {
    this.signer = fn;
  }

  /**
   * setWalletAdapterSigner
   *
   * Inject a signer from Solana wallet-adapter (preferred path when available).
   * This is not persisted and is safe to re-inject on every page load.
   */
  setWalletAdapterSigner(fn?: (message: Uint8Array) => Promise<Uint8Array>): void {
    this.walletAdapterSigner = fn;
  }

  /**
   * setUnlockBuilderForTests
   *
   * Test-only hook: inject a deterministic unlock builder so unit tests can control
   * the returned `BuildUnlockResult` (including `expiresAt`) without monkeypatching ESM exports.
   *
   * IMPORTANT:
   * - This MUST NOT be used by production code.
   * - The injected builder is memory-only and is cleared by calling this with `undefined`.
   */
  setUnlockBuilderForTests(
    fn?: (params: {
      origin?: string;
      wallet: string;
      vaultId?: string;
      nonceBytes?: Uint8Array;
      issuedAt?: string;
      expiresAt?: string;
    }) => Promise<BuildUnlockResult>
  ): void {
    this.unlockBuilder = fn;
  }

  /**
   * setVaultRootBuilderForTests
   *
   * Test-only hook: inject a deterministic vault-root builder so unit tests can control
   * the returned `BuildVaultRootResult` without monkeypatching ESM exports.
   *
   * IMPORTANT:
   * - This MUST NOT be used by production code.
   * - The injected builder is memory-only and is cleared by calling this with `undefined`.
   */
  setVaultRootBuilderForTests(
    fn?: (params: { origin?: string; wallet: string; vaultId?: string }) => Promise<BuildVaultRootResult>
  ): void {
    this.vaultRootBuilder = fn;
  }

  /**
   * Connect a wallet (e.g. after Phantom connect).
   * Per Task 3.5 connecting a wallet must lock the vault.
   *
   * @param pubKey - wallet public key (base58)
   * @param provider - optional provider id (e.g. "phantom")
   */
  async connectWallet(pubKey: any, provider?: string): Promise<void> {
    this.logWalletMutation("connect");
    sjDebugLog("connectWallet() called", {
      inputType: typeof pubKey,
      provider: provider ?? null,
      prevWalletPubKey: this.walletPubKey,
      prevVaultUnlocked: this.vaultUnlocked,
      stack: shortStackTrace(),
    });

    // Normalize pubKey argument to a base58 string if possible.
    // Accepts string, PublicKey-like objects (with toBase58), or other.
    let normalizedPubKey: string | null = null;
    try {
      if (!pubKey) {
        normalizedPubKey = null;
      } else if (typeof pubKey === "string") {
        normalizedPubKey = pubKey;
      } else if (pubKey && typeof (pubKey as any).toBase58 === "function") {
        // PublicKey-like object from @solana/web3.js
        normalizedPubKey = (pubKey as any).toBase58();
      } else if (pubKey && typeof pubKey.toString === "function") {
        normalizedPubKey = String(pubKey);
      } else {
        normalizedPubKey = null;
      }
    } catch {
      // fallback to string coercion
      try {
        normalizedPubKey = String(pubKey);
      } catch {
        normalizedPubKey = null;
      }
    }

    // Always lock the vault on connect
    const prevPubKey = this.walletPubKey;
    this.walletPubKey = normalizedPubKey;
    this.logWalletMutation("setWalletPubKey");
    this.walletProvider = provider || null;
    this.vaultUnlocked = false;

    sjDebugLog("connectWallet() applied", {
      prevWalletPubKey: prevPubKey,
      walletPubKey: this.walletPubKey,
      walletProvider: this.walletProvider,
      vaultUnlocked: this.vaultUnlocked,
    });

    // If the persisted Verified signal belongs to another pubkey, clear it
    if (this.verified && this.verified.walletPubKey !== normalizedPubKey) {
      sjDebugLog("connectWallet() clearing persisted verified (wallet mismatch)", {
        verifiedWalletPubKey: this.verified.walletPubKey,
        normalizedPubKey,
      });
      clearVerified();
      this.verified = null;
    }

    // If local storage contains a still-valid verified state for this pubKey, keep it in memory
    if (!this.verified) {
      const loaded = loadVerified();
      if (loaded && loaded.walletPubKey === normalizedPubKey) {
        this.verified = loaded;
        sjDebugLog("connectWallet() loaded verified from storage", {
          walletPubKey: normalizedPubKey,
          expiresAt: loaded.expiresAt,
        });
      }
    }

    // If wallet changed unexpectedly (hot-switch), ensure Verified cleared (no hot-switch allowed)
    if (prevPubKey && prevPubKey !== normalizedPubKey) {
      // the above logic already cleared verified if needed; keep vault locked
      this.vaultUnlocked = false;

      // Task 6: also clear in-memory unlock material (no hot-switch allowed)
      this.lastUnlock = null;
      this.lastUnlockSignatureBytes = null;
      this.lastVaultRoot = null;
      this.lastVaultRootSignatureBytes = null;

      sjDebugLog("connectWallet() hot-switch detected: cleared in-memory unlock + vaultRoot", {
        from: prevPubKey,
        to: normalizedPubKey,
      });
    }

    // Notify UI / hooks that session state changed so listeners can refresh immediately.
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event("sj-session-changed"));
      }
    } catch {
      // ignore browser quirks
    }
  }

  /**
   * Unlock the vault by requesting a signature for the canonical message and verifying it client-side.
   * - On success: set vaultUnlocked=true (memory only) and persist a non-sensitive Verified signal (TTL).
   * - Throws on failure (no wallet, no signature, verification failure).
   */
  async unlockVault(): Promise<void> {
    if (!this.walletPubKey) {
      throw new Error("Wallet not connected");
    }

    sjDebugLog("unlockVault() start", {
      walletPubKey: this.walletPubKey,
      vaultUnlockedBefore: this.vaultUnlocked,
      hasVerified: Boolean(this.verified),
    });

    const origin = (typeof window !== "undefined" && window.location) ? window.location.origin : "http://localhost";
    const now = Date.now();
    const vaultId = "local-default";

    /* -------------------------
     * 1) Unlock Vault (SJ_UNLOCK_V1) — volatile + TTL (session gating)
     * ------------------------- */
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();

    const unlockBuilder = this.unlockBuilder ?? buildUnlockMessageV1;

    const unlock: BuildUnlockResult = await unlockBuilder({
      origin,
      wallet: this.walletPubKey,
      vaultId,
      issuedAt,
      expiresAt,
    });

    await debugLogMessageToSignSha256("SJ_UNLOCK_V1", unlock.messageToSign);
    const unlockMessageBytes = new TextEncoder().encode(unlock.messageToSign);

    let unlockSignatureBytes: Uint8Array | null = null;

    // Prefer injected wallet-adapter signer when available (reduces popup flicker/races).
    if (this.walletAdapterSigner) {
      unlockSignatureBytes = await this.walletAdapterSigner(unlockMessageBytes);
    } else if (this.signer) {
      unlockSignatureBytes = await this.signer(unlockMessageBytes);
    } else {
      if (typeof window !== "undefined") {
        const anyWin = window as any;
        try {
          if (anyWin?.solana?.signMessage && typeof anyWin.solana.signMessage === "function") {
            const res = await anyWin.solana.signMessage(unlockMessageBytes, "utf8");
            if (res && res.signature) {
              unlockSignatureBytes = toUint8Array(res.signature as any);
            }
          } else if (anyWin?.solana?.request && typeof anyWin.solana.request === "function") {
            try {
              const res = await anyWin.solana.request({ method: "signMessage", params: [Array.from(unlockMessageBytes)] });
              if (res && res.signature) {
                unlockSignatureBytes = toUint8Array(res.signature as any);
              }
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (!unlockSignatureBytes) {
      throw new Error("No signature available from wallet/provider");
    }

    // Store unlock material in-memory only
    this.lastUnlock = unlock;
    this.lastUnlockSignatureBytes = unlockSignatureBytes;

    // Enforce OQ-06 at Unlock time (must refuse expired unlock messages)
    // We DO NOT persist KEK; we only validate the unlock is not expired.
    const unlockSaltBytes = cryptoGetRandomBytes(32);
    await deriveKekFromUnlockSignature({
      signatureBytes: unlockSignatureBytes,
      saltBytes: unlockSaltBytes,
      unlock,
      nowMs: now,
    });

    /* -------------------------
     * 2) Vault Root (SJ_VAULT_ROOT_V1) — stable root for manifest KEK
     * ------------------------- */
    const vaultRootBuilder = this.vaultRootBuilder ?? buildVaultRootMessageV1;
    const vaultRoot: BuildVaultRootResult = await vaultRootBuilder({
      wallet: this.walletPubKey,
      vaultId,
    });

    await debugLogMessageToSignSha256("SJ_VAULT_ROOT_V1", vaultRoot.messageToSign);
    const vaultRootMessageBytes = new TextEncoder().encode(vaultRoot.messageToSign);

    let vaultRootSignatureBytes: Uint8Array | null = null;

    // Prefer injected wallet-adapter signer when available (reduces popup flicker/races).
    if (this.walletAdapterSigner) {
      vaultRootSignatureBytes = await this.walletAdapterSigner(vaultRootMessageBytes);
    } else if (this.signer) {
      // In tests, the signer is injected; we reuse it for vault-root signing.
      vaultRootSignatureBytes = await this.signer(vaultRootMessageBytes);
    } else {
      if (typeof window !== "undefined") {
        const anyWin = window as any;
        try {
          if (anyWin?.solana?.signMessage && typeof anyWin.solana.signMessage === "function") {
            const res = await anyWin.solana.signMessage(vaultRootMessageBytes, "utf8");
            if (res && res.signature) {
              vaultRootSignatureBytes = toUint8Array(res.signature as any);
            }
          } else if (anyWin?.solana?.request && typeof anyWin.solana.request === "function") {
            try {
              const res = await anyWin.solana.request({ method: "signMessage", params: [Array.from(vaultRootMessageBytes)] });
              if (res && res.signature) {
                vaultRootSignatureBytes = toUint8Array(res.signature as any);
              }
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (!vaultRootSignatureBytes) {
      throw new Error("No vault-root signature available from wallet/provider");
    }

    // Store vault-root material in-memory only (used by manifest service to derive stable KEK)
    this.lastVaultRoot = vaultRoot;
    this.lastVaultRootSignatureBytes = vaultRootSignatureBytes;

    /* -------------------------
     * 3) Verified signal (UX-only; remains separate from KEK derivation)
     * ------------------------- */
    const verifiedAt = nowMs();
    const ttlMs = DEFAULT_VERIFIED_TTL_MS;
    const v: VerifiedState = {
      walletPubKey: this.walletPubKey,
      verifiedAt,
      expiresAt: verifiedAt + ttlMs,
      walletProvider: this.walletProvider || undefined,
      nonce: (this.verified as any)?.nonce,
      issuedAt: (this.verified as any)?.issuedAt,
    } as any;

    saveVerified(v);
    this.verified = v;

    // Set VaultUnlocked in memory only
    this.vaultUnlocked = true;

    sjDebugLog("unlockVault() success", {
      walletPubKey: this.walletPubKey,
      vaultUnlockedAfter: this.vaultUnlocked,
      hasLastUnlock: Boolean(this.lastUnlock && this.lastUnlockSignatureBytes),
      hasVaultRoot: Boolean(this.lastVaultRoot && this.lastVaultRootSignatureBytes),
    });

    // Notify listeners immediately that session state changed (vault unlocked)
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event("sj-session-changed"));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Lock vault immediately (memory-only)
   */
  lockVault(): void {
    this.vaultUnlocked = false;

    // Task 6: clear in-memory unlock + vault-root material on explicit lock
    this.lastUnlock = null;
    this.lastUnlockSignatureBytes = null;
    this.lastVaultRoot = null;
    this.lastVaultRootSignatureBytes = null;

    // Notify listeners immediately that session state changed (vault locked)
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event("sj-session-changed"));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Task 6 (Manifest v1):
   * Expose the in-memory SJ_UNLOCK_V1 material required to derive KEK and unwrap the manifest key.
   *
   * IMPORTANT:
   * - This is intentionally memory-only and MUST NOT be persisted.
   * - Callers MUST treat the signature bytes as sensitive session material.
   */
  getLastUnlock(): BuildUnlockResult | null {
    return this.lastUnlock;
  }

  /**
   * Task 6 (Manifest v1):
   * Return the in-memory signature bytes that correspond to `getLastUnlock().messageToSign`.
   *
   * Returns null when vault has not been unlocked in this session/tab.
   */
  getLastUnlockSignatureBytes(): Uint8Array | null {
    return this.lastUnlockSignatureBytes;
  }

  /**
   * Task 6 (Vault Root):
   * Return the in-memory Vault Root build result (SJ_VAULT_ROOT_V1).
   */
  getLastVaultRoot(): BuildVaultRootResult | null {
    return this.lastVaultRoot;
  }

  /**
   * Task 6 (Vault Root):
   * Return the in-memory signature bytes that correspond to `getLastVaultRoot().messageToSign`.
   *
   * This is the ONLY valid signature root for stable manifest KEK derivation across refresh.
   */
  getLastVaultRootSignatureBytes(): Uint8Array | null {
    return this.lastVaultRootSignatureBytes;
  }

  /**
   * Returns whether a wallet is connected (pubkey present)
   */
  isWalletConnected(): boolean {
    return !!this.walletPubKey;
  }

  /**
   * Returns whether the Vault is currently unlocked in memory
   */
  isVaultUnlocked(): boolean {
    return this.vaultUnlocked;
  }

  /**
   * Returns the connected wallet pubkey (base58) or null
   */
  getWalletPubKey(): string | null {
    return this.walletPubKey;
  }

  /**
   * Returns the non-sensitive verified signal if present and not expired.
   * This re-reads localStorage to stay consistent with external changes.
   */
  getVerified(): VerifiedState | null {
    this.verified = loadVerified();
    return this.verified;
  }

  /**
   * Disconnect wallet: clear pubkey, provider, vault state and verified signal.
   */
  disconnectWallet(): void {
    this.logWalletMutation("disconnect");
    if (isSjDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.log('[SJ_DEBUG][Session] disconnect does NOT touch manifest keys')
    }
    sjDebugLog("disconnectWallet() called", {
      prevWalletPubKey: this.walletPubKey,
      vaultUnlockedBefore: this.vaultUnlocked,
      stack: shortStackTrace(),
    });

    this.walletPubKey = null;
    this.logWalletMutation("setWalletPubKey");
    this.walletProvider = null;
    this.vaultUnlocked = false;

    // Task 6: clear in-memory unlock + vault-root material on disconnect
    // (must never be reused across wallets/sessions and must not be persisted)
    this.lastUnlock = null;
    this.lastUnlockSignatureBytes = null;
    this.lastVaultRoot = null;
    this.lastVaultRootSignatureBytes = null;

    clearVerified();
    this.verified = null;

    sjDebugLog("disconnectWallet() applied", {
      walletPubKey: this.walletPubKey,
      vaultUnlockedAfter: this.vaultUnlocked,
      hasVerified: Boolean(this.verified),
    });

    // Notify listeners immediately that session state changed (wallet disconnected)
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event("sj-session-changed"));
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Convenience singleton instance
 */
export const session = new SessionManager();

export default SessionManager;
