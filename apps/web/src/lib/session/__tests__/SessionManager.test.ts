import { describe, it, expect, beforeEach } from "vitest";
import * as nacl from "tweetnacl";
import bs58 from "bs58";

import SessionManager, { MESSAGE_TO_SIGN } from "../SessionManager";

function makeMockLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

describe("SessionManager (Task 3.5) - unit tests", () => {
  beforeEach(() => {
    // Replace localStorage with a deterministic mock to avoid environment differences
    // @ts-ignore - test environment
    globalThis.localStorage = makeMockLocalStorage();
    // Ensure no accidental provider on window
    // @ts-ignore
    if (typeof globalThis.window !== "undefined") (globalThis as any).window.solana = undefined;
  });

  it("initial state: vault locked and not connected", () => {
    const sm = new SessionManager();
    expect(sm.isWalletConnected()).toBe(false);
    expect(sm.isVaultUnlocked()).toBe(false);
    expect(sm.getVerified()).toBeNull();
  });

  it("connectWallet locks the vault and records pubkey but does not unlock", async () => {
    const sm = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm.connectWallet(pubKey, "phantom");
    expect(sm.isWalletConnected()).toBe(true);
    expect(sm.getWalletPubKey()).toBe(pubKey);
    expect(sm.isVaultUnlocked()).toBe(false);
  });

  it("unlockVault with injected signer sets vault unlocked and persists verified signal", async () => {
    const sm = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm.connectWallet(pubKey, "phantom");

    // Inject a signer that uses the secret key to sign the canonical message
    sm.setSigner(async (msg: Uint8Array) => {
      return nacl.sign.detached(msg, kp.secretKey);
    });

    expect(sm.isVaultUnlocked()).toBe(false);
    await sm.unlockVault();
    expect(sm.isVaultUnlocked()).toBe(true);

    const verified = sm.getVerified();
    expect(verified).not.toBeNull();
    expect(verified!.walletPubKey).toBe(pubKey);
    expect(typeof verified!.verifiedAt).toBe("number");
    expect(typeof verified!.expiresAt).toBe("number");

    // Ensure the persisted storage contains the non-sensitive signal
    // @ts-ignore
    const raw = globalThis.localStorage.getItem("sj_verified_v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.walletPubKey).toBe(pubKey);
  });

  it("vaultUnlocked is memory-only: new SessionManager starts with locked vault but can read persisted Verified", async () => {
    // First, create a manager, verify and unlock
    const sm1 = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm1.connectWallet(pubKey, "phantom");
    sm1.setSigner(async (m) => nacl.sign.detached(m, kp.secretKey));
    await sm1.unlockVault();
    expect(sm1.isVaultUnlocked()).toBe(true);
    const v1 = sm1.getVerified();
    expect(v1).not.toBeNull();

    // Simulate page refresh by creating a fresh instance
    const sm2 = new SessionManager();
    // Vault must be locked on new instance (memory-only)
    expect(sm2.isVaultUnlocked()).toBe(false);
    // But getVerified should read the persisted metadata
    const v2 = sm2.getVerified();
    expect(v2).not.toBeNull();
    expect(v2!.walletPubKey).toBe(pubKey);
  });

  it("lockVault explicitly locks the vault", async () => {
    const sm = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm.connectWallet(pubKey);
    sm.setSigner(async (m) => nacl.sign.detached(m, kp.secretKey));
    await sm.unlockVault();
    expect(sm.isVaultUnlocked()).toBe(true);
    sm.lockVault();
    expect(sm.isVaultUnlocked()).toBe(false);
  });

  it("disconnectWallet clears wallet, vault and verified signal", async () => {
    const sm = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm.connectWallet(pubKey);
    sm.setSigner(async (m) => nacl.sign.detached(m, kp.secretKey));
    await sm.unlockVault();

    expect(sm.isWalletConnected()).toBe(true);
    expect(sm.isVaultUnlocked()).toBe(true);
    expect(sm.getVerified()).not.toBeNull();

    sm.disconnectWallet();

    expect(sm.isWalletConnected()).toBe(false);
    expect(sm.isVaultUnlocked()).toBe(false);
    expect(sm.getVerified()).toBeNull();
    // storage cleared
    // @ts-ignore
    expect(globalThis.localStorage.getItem("sj_verified_v1")).toBeNull();
  });

  it("unlockVault throws if no signature is available from provider/signer", async () => {
    const sm = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm.connectWallet(pubKey);
    // Do not set signer and do not mock window.solana => should fail
    await expect(sm.unlockVault()).rejects.toThrow(/No signature available/);
  });

  it("unlockVault throws when signature verification fails", async () => {
    const sm = new SessionManager();
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);

    await sm.connectWallet(pubKey);

    // Inject a signer that returns a random/invalid signature (wrong size)
    sm.setSigner(async () => {
      // produce random bytes
      return nacl.randomBytes(64);
    });

    await expect(sm.unlockVault()).rejects.toThrow(/Signature verification failed/);
  });

  it("connecting a different wallet clears previously persisted Verified signal", async () => {
    // First user
    const sm = new SessionManager();
    const kp1 = nacl.sign.keyPair();
    const pub1 = bs58.encode(kp1.publicKey);
    await sm.connectWallet(pub1, "phantom");
    sm.setSigner(async (m) => nacl.sign.detached(m, kp1.secretKey));
    await sm.unlockVault();
    expect(sm.getVerified()!.walletPubKey).toBe(pub1);

    // Now simulate connecting another wallet on the same instance
    const kp2 = nacl.sign.keyPair();
    const pub2 = bs58.encode(kp2.publicKey);

    await sm.connectWallet(pub2, "phantom");
    // Verified should be cleared because pubkey changed
    expect(sm.getVerified()).toBeNull();
    // Ensure persisted storage does not contain the first pubkey
    // @ts-ignore
    const raw = globalThis.localStorage.getItem("sj_verified_v1");
    expect(raw).toBeNull();
  });

  it("MESSAGE_TO_SIGN matches expected stable template", () => {
    // simple sanity check to guarantee the canonical message hasn't changed unexpectedly
    expect(MESSAGE_TO_SIGN).toContain("SOVEREIGN_JEDI_UNLOCK_VAULT_V1");
    expect(MESSAGE_TO_SIGN).toContain("déverrouille temporairement votre coffre");
  });
});
