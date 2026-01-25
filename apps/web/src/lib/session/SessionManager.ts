/**
 * SessionManager for Sovereign Jedi — Task 3.5
 *
 * Responsibilities:
 * - Expose the contract API required by Task 3.5:
 *   connectWallet(), unlockVault(), lockVault(), isWalletConnected(), isVaultUnlocked()
 * - Keep `VaultUnlocked` strictly in-memory (lost on refresh / tab close)
 * - Persist a non-sensitive `Verified` signal in localStorage with a TTL (default 24h)
 *   containing only non-secret metadata (walletPubKey, verifiedAt, expiresAt, optional provider)
 * - Perform client-side signature verification (ed25519 / tweetnacl) for the unlock flow
 *
 * Notes:
 * - Targeted for Phantom / Solana flows in Task 3.5 (window.solana) — minimal and explicit.
 * - No cryptographic key material (KEKs, private seeds, derived keys) is generated or stored.
 * - The Verified signal is a UX convenience only and must not be treated as a security boundary.
 */

import * as nacl from "tweetnacl";
import bs58 from "bs58";

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
  private walletPubKey: string | null = null; // base58 string
  private walletProvider: string | null = null;
  private vaultUnlocked = false; // memory-only
  private verified: VerifiedState | null = null;

  // Optional injected signer for testing or alternative integrations.
  // The signer MUST accept the message bytes and return a signature bytes (Uint8Array).
  private signer?: (message: Uint8Array) => Promise<Uint8Array>;

  constructor() {
    // Load persisted non-sensitive verified signal if available.
    this.verified = loadVerified();
    // Enforce Task 3.5 invariant: VaultUnlocked MUST be false on initialization (fresh session).
    this.vaultUnlocked = false;
  }

  /**
   * Inject a signer function (useful for unit tests or when the environment
   * provides a different signature API).
   */
  setSigner(fn: (message: Uint8Array) => Promise<Uint8Array>): void {
    this.signer = fn;
  }

  /**
   * Connect a wallet (e.g. after Phantom connect).
   * Per Task 3.5 connecting a wallet must lock the vault.
   *
   * @param pubKey - wallet public key (base58)
   * @param provider - optional provider id (e.g. "phantom")
   */
  async connectWallet(pubKey: any, provider?: string): Promise<void> {
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
    this.walletProvider = provider || null;
    this.vaultUnlocked = false;

    // If the persisted Verified signal belongs to another pubkey, clear it
    if (this.verified && this.verified.walletPubKey !== normalizedPubKey) {
      clearVerified();
      this.verified = null;
    }

    // If local storage contains a still-valid verified state for this pubKey, keep it in memory
    if (!this.verified) {
      const loaded = loadVerified();
      if (loaded && loaded.walletPubKey === normalizedPubKey) {
        this.verified = loaded;
      }
    }

    // If wallet changed unexpectedly (hot-switch), ensure Verified cleared (no hot-switch allowed)
    if (prevPubKey && prevPubKey !== normalizedPubKey) {
      // the above logic already cleared verified if needed; keep vault locked
      this.vaultUnlocked = false;
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

    // Build a per-session unlock message including domain, publicKey, issuedAt and nonce.
    // This helps prevent message replay attacks while keeping verification entirely client-side.
    const issuedAtIso = new Date().toISOString();
    const nonce = (function () {
      try {
        if (typeof window !== "undefined" && window.crypto && typeof window.crypto.getRandomValues === "function") {
          const arr = new Uint8Array(16);
          window.crypto.getRandomValues(arr);
          return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
      } catch {
        // fallthrough
      }
      // Fallback pseudo-random value (non-cryptographic) — acceptable as fallback only.
      return Math.random().toString(16).slice(2) + Date.now().toString(16);
    })();

    const domain = (typeof window !== "undefined" && window.location && window.location.host) ? window.location.host : "localhost";
    const message = `${MESSAGE_PREFIX}
domain: ${domain}
publicKey: ${this.walletPubKey}
issuedAt: ${issuedAtIso}
nonce: ${nonce}

Cette signature déverrouille temporairement votre coffre pour la session en cours.`;

    const messageBytes = new TextEncoder().encode(message);

    // 1) Obtain a signature via the injected signer, if present
    let signatureBytes: Uint8Array | null = null;
    if (this.signer) {
      signatureBytes = await this.signer(messageBytes);
    } else {
      // 2) Try to use window.solana.signMessage (Phantom-like)
      if (typeof window !== "undefined") {
        const anyWin = window as any;
        try {
          if (anyWin?.solana?.signMessage && typeof anyWin.solana.signMessage === "function") {
            // Phantom's signMessage typically accepts Uint8Array and returns { signature: Uint8Array }
            const res = await anyWin.solana.signMessage(messageBytes, "utf8");
            if (res && res.signature) {
              // res.signature might already be Uint8Array or base58/base64 string in some adapters
              signatureBytes = toUint8Array(res.signature as any);
            }
          } else if (anyWin?.solana?.request && typeof anyWin.solana.request === "function") {
            // Some providers implement a generic request for signMessage
            try {
              const res = await anyWin.solana.request({ method: "signMessage", params: [Array.from(messageBytes)] });
              if (res && res.signature) {
                signatureBytes = toUint8Array(res.signature as any);
              }
            } catch {
              // ignore and let the absent signature be handled below
            }
          }
        } catch {
          // ignore provider errors — will be handled below
        }
      }
    }

    if (!signatureBytes) {
      throw new Error("No signature available from wallet/provider");
    }

    // Verify signature client-side with the known pubkey
    const pubKeyBytes = toUint8Array(this.walletPubKey);
    let ok = false;
    try {
      ok = nacl.sign.detached.verify(messageBytes, signatureBytes, pubKeyBytes);
    } catch (e) {
      // Normalize errors from the verification library (e.g. bad signature size)
      throw new Error("Signature verification failed");
    }
    if (!ok) throw new Error("Signature verification failed");

    // Persist a non-sensitive Verified signal (metadata only) and include nonce/issuedAt
    const verifiedAt = nowMs();
    const ttlMs = DEFAULT_VERIFIED_TTL_MS; // default 24h as per project doc
    const expiresAt = verifiedAt + ttlMs;
    const v: VerifiedState = {
      walletPubKey: this.walletPubKey,
      verifiedAt,
      expiresAt,
      walletProvider: this.walletProvider || undefined,
      nonce,
      issuedAt: issuedAtIso,
    };
    saveVerified(v);
    this.verified = v;

    // Set VaultUnlocked in memory only
    this.vaultUnlocked = true;

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
    this.walletPubKey = null;
    this.walletProvider = null;
    this.vaultUnlocked = false;
    clearVerified();
    this.verified = null;
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
