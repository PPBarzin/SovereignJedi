declare module '@sj/crypto' {
  /**
   * Low-level utilities and crypto helpers exported by @sj/crypto
   * (lightweight, intentionally minimal typings used for the web app)
   */

  export function cryptoGetRandomBytes(len?: number): Uint8Array;

  export function utf8Encode(input: string): Uint8Array;
  export function utf8Decode(input: Uint8Array | ArrayBuffer): string;

  export function toHex(bytes: Uint8Array | ArrayBuffer): string;
  export function fromHex(hex: string): Uint8Array;

  export function sha256(data: Uint8Array | ArrayBuffer): Promise<Uint8Array>;

  // AES-GCM helpers ----------------------------------------------------------
  export function importAesKey(raw: Uint8Array): Promise<CryptoKey>;
  export function exportAesKey(key: CryptoKey): Promise<Uint8Array>;
  export function encryptAesGcmWithRawKey(
    rawKey: Uint8Array,
    plaintext: Uint8Array,
    iv?: Uint8Array
  ): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>;
  export function decryptAesGcmWithRawKey(
    rawKey: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;

  export function generateAesKey(): Promise<CryptoKey>;
  export function encryptAesGcm(
    key: CryptoKey,
    plaintext: Uint8Array,
    iv?: Uint8Array
  ): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>;
  export function decryptAesGcm(
    key: CryptoKey,
    iv: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;

  // Self-test / utility
  export function runSelfTest(): Promise<{ hkdfDerivedHex: string; encryptedHex: string; decryptedText: string }>;

  // Default export (commonjs/esm interop)
  const _default: {
    cryptoGetRandomBytes: typeof cryptoGetRandomBytes;
    utf8Encode: typeof utf8Encode;
    utf8Decode: typeof utf8Decode;
    toHex: typeof toHex;
    fromHex: typeof fromHex;
    sha256: typeof sha256;
    importAesKey: typeof importAesKey;
    exportAesKey: typeof exportAesKey;
    encryptAesGcmWithRawKey: typeof encryptAesGcmWithRawKey;
    decryptAesGcmWithRawKey: typeof decryptAesGcmWithRawKey;
    generateAesKey: typeof generateAesKey;
    encryptAesGcm: typeof encryptAesGcm;
    decryptAesGcm: typeof decryptAesGcm;
    runSelfTest: typeof runSelfTest;
  };

  export default _default;
}

declare module '@sj/storage' {
  /**
   * Minimal typed surface for @sj/storage used by the web app.
   * Matches the runtime API implemented in the package (Dexie-based).
   */

  export type Base64 = string;

  export interface ManifestPayload {
    walletId: string;
    encryptedManifestB64: Base64;
    manifestCid?: string | null;
    createdAt: string;
    updatedAt: string;
  }

  export function toBase64(input: Uint8Array | string): Base64;
  export function fromBase64(b64: Base64): Uint8Array;

  export function initStorage(dbName?: string): unknown;

  export function putManifest(
    walletId: string,
    encryptedManifest: Base64 | Uint8Array,
    manifestCid?: string | null
  ): Promise<ManifestPayload>;

  export function getManifest(walletId: string): Promise<ManifestPayload | null>;

  export function deleteManifest(walletId: string): Promise<boolean>;

  export function listManifests(): Promise<ManifestPayload[]>;

  export function getEncryptedManifestBytes(walletId: string): Promise<Uint8Array | null>;

  const _default: {
    initStorage: typeof initStorage;
    putManifest: typeof putManifest;
    getManifest: typeof getManifest;
    deleteManifest: typeof deleteManifest;
    listManifests: typeof listManifests;
    getEncryptedManifestBytes: typeof getEncryptedManifestBytes;
    toBase64: typeof toBase64;
    fromBase64: typeof fromBase64;
  };

  export default _default;
}

/*
 * Some build setups / imports in the web app reference the built package outputs directly
 * (e.g. "../../packages/crypto/dist" or "../../packages/storage/dist"). Provide the
 * same typings for those import paths so TypeScript resolution succeeds.
 */

declare module '../../packages/crypto/dist' {
  import crypto from '@sj/crypto';
  export = crypto;
}
declare module '../../packages/crypto/dist/index.js' {
  import crypto from '@sj/crypto';
  export = crypto;
}
declare module '../../packages/storage/dist' {
  import storage from '@sj/storage';
  export = storage;
}
declare module '../../packages/storage/dist/index.js' {
  import storage from '@sj/storage';
  export = storage;
}
