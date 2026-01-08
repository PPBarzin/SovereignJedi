/**
 * Sovereign Jedi — @sj/storage
 * Dexie wrapper for local encrypted manifest storage (IndexedDB)
 *
 * Responsibilities:
 * - Persist encrypted user manifests (binary or base64) keyed by wallet identity.
 * - Store optional manifest CID (IPFS).
 * - Provide simple API: initStorage, putManifest, getManifest, deleteManifest, listManifests.
 *
 * Notes:
 * - This module intentionally does NOT perform any cryptography. It stores the already-encrypted
 *   manifest (as Uint8Array or base64 string). Encryption/decryption should be handled by @sj/crypto
 *   higher-level logic.
 * - In Node.js environments without IndexedDB this will fail; intended runtime is browser (or Node
 *   environments that provide indexedDB shims).
 */

import Dexie from "dexie";

/* ---------------------------
 * Types
 * --------------------------- */

export type Base64 = string;

export interface ManifestEntry {
  cid: string; // IPFS CID
  envelopeB64: Base64; // envelope that allows wallet to retrieve per-file key (encrypted)
  name?: string;
  createdAt?: string; // ISO timestamp
  meta?: Record<string, any>;
}

export interface ManifestPayload {
  walletId: string;
  // encrypted manifest content as base64 string (consumer must encrypt before calling put)
  encryptedManifestB64: Base64;
  // optional IPFS CID of the encrypted manifest
  manifestCid?: string | null;
  // created/updated timestamps
  createdAt: string;
  updatedAt: string;
}

/* Internal DB record shape */
interface ManifestRecord {
  walletId: string; // primary key
  encryptedManifestB64: Base64;
  manifestCid?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------
 * Helpers
 * --------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

export function toBase64(input: Uint8Array | string): Base64 {
  if (typeof input === "string") {
    // assume already base64 or plaintext; consumer should pass base64 for binary
    return input;
  }
  // browser friendly conversion
  let binary = "";
  const len = input.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(input[i]);
  }
  // btoa works on binary string
  return btoa(binary);
}

export function fromBase64(b64: Base64): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

/* ---------------------------
 * Dexie DB
 * --------------------------- */

class SJStorageDB extends Dexie {
  manifests!: Dexie.Table<ManifestRecord, string>;

  constructor(dbName = "sovereign_jedi_storage") {
    super(dbName);
    // version 1 schema: manifests keyed by walletId
    this.version(1).stores({
      manifests: "walletId,manifestCid,updatedAt,createdAt",
    });
    // map tables to TypeScript members
    this.manifests = this.table("manifests");
  }
}

/* Manage DB instances per name to avoid reusing closed Dexie instances and to prevent
  DatabaseClosedError during tests that create/delete many temporary DBs. */
let lastDbInstance: SJStorageDB | null = null;
const dbInstances: Map<string, SJStorageDB> = new Map();

/* ---------------------------
 * Public API
 * --------------------------- */

/**
 * Initialize storage (creates or opens the IndexedDB).
 * This implementation keeps one SJStorageDB instance per database name. When a new
 * name is requested we close and remove other instances to avoid interference in
 * constrained test environments.
 *
 * @param dbName optional database name
 * @returns the Dexie instance
 */
export function initStorage(dbName?: string): SJStorageDB {
  const name = dbName ?? "sovereign_jedi_storage";

  // Return existing open instance if available
  const existing = dbInstances.get(name);
  if (existing) {
    try {
      // Dexie exposes `.isOpen()` as a property function in some versions or `.open()` state.
      // Use a defensive check: if `isOpen` exists and reports true, reuse. If it reports closed,
      // fall through to recreate a fresh instance. If there's no `isOpen`, assume it's usable.
      const isOpenCheck = (existing as any).isOpen;
      if (typeof isOpenCheck === "function") {
        if ((existing as any).isOpen()) {
          return existing;
        }
        // closed -> recreate below
      } else if (typeof isOpenCheck === "boolean") {
        if ((existing as any).isOpen) {
          return existing;
        }
        // closed -> recreate below
      } else {
        // No isOpen information available; assume instance is usable
        return existing;
      }
    } catch {
      // If checking `isOpen()` throws for some reason, fall back to recreating a fresh instance.
    }
  }

  // Basic runtime check
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "IndexedDB is not available in this environment. @sj/storage requires IndexedDB (browser or shim)."
    );
  }

  // Close and remove other DB instances to avoid interference in tests which create
  // and delete many DBs with distinct names. This is a best-effort cleanup.
  for (const [k, inst] of Array.from(dbInstances.entries())) {
    if (k === name) continue;
    try {
      // Dexie exposes a `close()` method to close the connection
      if (typeof (inst as any).close === "function") {
        (inst as any).close();
      }
    } catch {
      // ignore any errors during close - best-effort
    }
    dbInstances.delete(k);
  }

  const db = new SJStorageDB(name);
  dbInstances.set(name, db);
  // Keep reference for legacy API functions that rely on a single last-used instance.
  lastDbInstance = db;
  return db;
}

/**
 * Put (create or update) an encrypted manifest for a wallet.
 * encryptedManifest may be either a base64 string or a Uint8Array.
 *
 * @param walletId unique wallet identifier (string)
 * @param encryptedManifest base64 string or Uint8Array (already encrypted)
 * @param manifestCid optional IPFS CID where the encrypted manifest was uploaded
 */
export async function putManifest(
  walletId: string,
  encryptedManifest: Base64 | Uint8Array,
  manifestCid?: string | null
): Promise<ManifestPayload> {
  if (!lastDbInstance) initStorage();

  const encryptedManifestB64 = typeof encryptedManifest === "string" ? encryptedManifest : toBase64(encryptedManifest);

  const now = nowIso();

  const existing = await lastDbInstance!.manifests.get(walletId);

  if (existing) {
    const updated: ManifestRecord = {
      walletId,
      encryptedManifestB64,
      manifestCid: manifestCid ?? existing.manifestCid ?? null,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    await lastDbInstance!.manifests.put(updated);
    return {
      walletId,
      encryptedManifestB64,
      manifestCid: updated.manifestCid,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  } else {
    const record: ManifestRecord = {
      walletId,
      encryptedManifestB64,
      manifestCid: manifestCid ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await lastDbInstance!.manifests.add(record);
    return {
      walletId,
      encryptedManifestB64,
      manifestCid: record.manifestCid,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

/**
 * Retrieve stored manifest payload for a wallet.
 * Returns null if not found.
 *
 * NOTE: The returned `encryptedManifestB64` is base64; consumer should call fromBase64() then decrypt.
 */
export async function getManifest(walletId: string): Promise<ManifestPayload | null> {
  if (!lastDbInstance) initStorage();

  const rec = await lastDbInstance!.manifests.get(walletId);
  if (!rec) return null;
  return {
    walletId: rec.walletId,
    encryptedManifestB64: rec.encryptedManifestB64,
    manifestCid: rec.manifestCid ?? null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

/**
 * Delete manifest for a wallet.
 * Returns true if deleted (or not present), false on error.
 */
export async function deleteManifest(walletId: string): Promise<boolean> {
  if (!lastDbInstance) initStorage();

  try {
    await lastDbInstance!.manifests.delete(walletId);
    return true;
  } catch (err) {
    console.error("deleteManifest error:", err);
    return false;
  }
}

/**
 * List all stored manifests (lightweight index).
 * Warning: this returns metadata and the base64 manifest; for large numbers consider pagination.
 */
export async function listManifests(): Promise<ManifestPayload[]> {
  if (!lastDbInstance) initStorage();

  const all = await lastDbInstance!.manifests.toArray();
  return all.map((r) => ({
    walletId: r.walletId,
    encryptedManifestB64: r.encryptedManifestB64,
    manifestCid: r.manifestCid ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/* ---------------------------
 * Convenience / Utilities
 * --------------------------- */

/**
 * getDecryptedManifestBytes
 * Convenience to return the encrypted manifest as Uint8Array (consumer must decrypt).
 */
export async function getEncryptedManifestBytes(walletId: string): Promise<Uint8Array | null> {
  const payload = await getManifest(walletId);
  if (!payload) return null;
  return fromBase64(payload.encryptedManifestB64);
}

/* ---------------------------
 * Exports & default
 * --------------------------- */

const storageAPI = {
  initStorage,
  putManifest,
  getManifest,
  deleteManifest,
  listManifests,
  getEncryptedManifestBytes,
  // utils (exposed for callers)
  toBase64,
  fromBase64,
};

export default storageAPI;
