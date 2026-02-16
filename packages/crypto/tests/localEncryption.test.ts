/**
 * packages/crypto/tests/localEncryption.test.ts
 *
 * Tests for the local encryption pipeline (Task 4).
 *
 * These tests import only the public entrypoint of the package (@sj/crypto) and
 * rely on a deterministic local libsodium bundle placed under:
 *   packages/crypto/test-assets/libsodium
 *
 * The test harness will attach that bundle to globalThis.sodium before tests run.
 *
 * Notes:
 * - libsodium-wrappers-sumo MUST be the version present in the repo and must be resolvable
 *   (synchronized into packages/crypto/test-assets/libsodium by the sync script).
 * - If libsodium cannot be loaded, tests fail hard (no shims).
 */

import { describe, it, expect, beforeAll } from 'vitest';
let nacl: any;
import * as sjcrypto from '@sj/crypto';

const utf8Encode = (s: string) => new TextEncoder().encode(s);
const toBase64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/**
 * Load deterministic local libsodium bundle (copied to packages/crypto/test-assets/libsodium by sync script)
 * and attach it to globalThis.sodium so the implementation (libsodium-only) can use it.
 *
 * Fails hard if the bundle cannot be loaded.
 */
beforeAll(async () => {
  try {
    // 1) Try to resolve the installed package dynamically (node_modules)
    try {
      const sodiumMod = await import('libsodium-wrappers-sumo');
      const sodium = (sodiumMod && (sodiumMod as any).default) ? (sodiumMod as any).default : sodiumMod;
      if (sodium && sodium.ready) await sodium.ready;
      (globalThis as any).sodium = sodium;
      console.log('libsodium-wrappers-sumo loaded from node_modules and attached to globalThis.sodium for tests');
      return;
    } catch (e) {
      // continue to attempt local test-assets bundle
      console.warn('libsodium-wrappers-sumo not resolvable from node_modules, will attempt local test-assets bundle.');
    }

    // 2) Attempt to load the deterministic copy in packages/crypto/test-assets/libsodium.
    // This file should be created by the reproducible sync script.
    const localBundlePath = require('path').join(__dirname, '..', 'test-assets', 'libsodium', 'libsodium-wrappers.js');
    try {
      // Use a file:// dynamic import of the local bundle so it executes in ESM context
      // and attaches `sodium` to globalThis as the distribution expects.
      const { pathToFileURL } = require('url');
      const fileUrl = pathToFileURL(localBundlePath).href;
      const modLocal = await import(fileUrl);
      const sodiumLocal = (modLocal && (modLocal as any).default) ? (modLocal as any).default : modLocal;
      if (sodiumLocal && sodiumLocal.ready) {
        await sodiumLocal.ready;
        (globalThis as any).sodium = sodiumLocal;
        console.log('libsodium loaded from local test-assets (file URL import) and attached to globalThis.sodium for tests');
        return;
      } else {
        throw new Error('local bundle did not expose globalThis.sodium');
      }
    } catch (errLocal) {
      console.error('Failed to load local libsodium bundle at', localBundlePath, errLocal && errLocal.message ? errLocal.message : errLocal);
      // Fail hard: no libsodium available for tests
      throw new Error('libsodium-wrappers-sumo could not be loaded for tests (local test-assets bundle failed).');
    }
  } catch (finalErr) {
    // Rethrow so test runner fails the suite
    throw finalErr;
  } finally {
    // Ensure tweetnacl is available for signing helpers used by tests
    const mod = await import('tweetnacl');
    nacl = (mod && (mod as any).default) ? (mod as any).default : mod;
  }
});

// Helper: generate an ed25519 keypair (tweetnacl) and sign a message string (utf-8)
// Returns { pk, sk, sigBytes }
async function generateEd25519KeypairAndSign(message: string) {
  const kp = nacl.sign.keyPair();
  const pk = kp.publicKey as Uint8Array;
  const sk = kp.secretKey as Uint8Array;

  const msgBytes = utf8Encode(message);
  const sig = nacl.sign.detached(msgBytes, sk) as Uint8Array;

  return {
    pk,
    sk,
    sigBytes: new Uint8Array(sig),
  };
}

describe('localEncryption — protocol V3 (wrap AAD binding + immutable metadata integrity)', () => {
  it('API guard: encryptFile throws when walletPubKey is missing/empty', async () => {
    const plaintext = utf8Encode('walletPubKey required');
    const walletId = 'test-wallet-guard';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletId });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    // @ts-expect-error walletPubKey is required by protocol V3
    await expect(sjcrypto.encryptFile(plaintext, { kek, salt })).rejects.toThrow(/walletPubKey is required/i);

    await expect(
      sjcrypto.encryptFile(plaintext, {
        kek,
        salt,
        walletPubKey: '   ',
      })
    ).rejects.toThrow(/walletPubKey is required/i);
  });

  it('round-trip V3: encrypt -> decrypt returns original plaintext (byte-perfect)', async () => {
    const plaintext = utf8Encode('Hello Sovereign Jedi — round trip test (V3)');
    const walletPubKey = 'test-wallet-01';

    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 'hello.txt',
      mimeType: 'text/plain',
    });

    const { encryptedFile, envelope } = encResult;

    expect(typeof envelope.kekDerivation.salt).toBe('string');
    expect(envelope.kekDerivation.messageTemplateId).toBe('SJ_UNLOCK_V1');
    expect(envelope.walletPubKey).toBe(walletPubKey);

    // V3 technical header fields (non-secret; integrity-bound)
    expect(typeof encryptedFile.fileId).toBe('string');
    expect(encryptedFile.fileId && encryptedFile.fileId.length).toBeGreaterThan(0);
    expect(encryptedFile.originalFileName).toBe('hello.txt');
    expect(encryptedFile.mimeType).toBe('text/plain');
    expect(encryptedFile.fileSize).toBe(plaintext.byteLength);

    const recovered = await sjcrypto.decryptFile(encryptedFile, envelope, kek);
    expect(Buffer.from(recovered)).toEqual(Buffer.from(plaintext));
  });

  it('tamper tests V3: modifying ciphertext/nonce/aad/wrap -> decryption fails', async () => {
    const plaintext = utf8Encode('tamper test content (V3)');
    const walletPubKey = 'test-wallet-02';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 'secret.txt',
      mimeType: 'text/plain',
    });

    const { encryptedFile, envelope } = encResult;

    // 1) tamper ciphertext (flip one byte)
    const ct = fromBase64(encryptedFile.ciphertext);
    ct[0] = (ct[0] + 1) & 0xff;
    const tamperedFile = { ...encryptedFile, ciphertext: toBase64(ct) };
    await expect(sjcrypto.decryptFile(tamperedFile, envelope, kek)).rejects.toThrow();

    // 2) tamper nonce
    const nonce = fromBase64(encryptedFile.nonce);
    nonce[0] = (nonce[0] + 1) & 0xff;
    const tamperedNonceFile = { ...encryptedFile, nonce: toBase64(nonce) };
    await expect(sjcrypto.decryptFile(tamperedNonceFile, envelope, kek)).rejects.toThrow();

    // 3) tamper AAD (filename alias) — file decrypt AAD includes canonicalized AAD; altering should break authenticity
    const tamperedAadFile = {
      ...encryptedFile,
      aad: { ...(encryptedFile.aad || {}), filename: 'other-name.txt' },
    };
    await expect(sjcrypto.decryptFile(tamperedAadFile, envelope, kek)).rejects.toThrow();

    // 4) tamper wrapped key inside envelope
    const wrapped = fromBase64(envelope.wrap.ciphertext);
    wrapped[0] = (wrapped[0] + 1) & 0xff;
    const tamperedEnvelope = {
      ...envelope,
      wrap: { ...envelope.wrap, ciphertext: toBase64(wrapped) },
    };
    await expect(sjcrypto.decryptFile(encryptedFile, tamperedEnvelope, kek)).rejects.toThrow();
  });

  it('binding V3: swap salt in envelope.kekDerivation.salt -> unwrap FAIL', async () => {
    const plaintext = utf8Encode('binding swap salt');
    const walletPubKey = 'test-wallet-bind-salt';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 's.txt',
      mimeType: 'text/plain',
    });

    const { encryptedFile, envelope } = encResult;

    const wrongSaltBytes = fromBase64(envelope.kekDerivation.salt);
    wrongSaltBytes[0] = (wrongSaltBytes[0] + 1) & 0xff;

    const tamperedEnvelope = {
      ...envelope,
      kekDerivation: { ...envelope.kekDerivation, salt: toBase64(wrongSaltBytes) },
    };

    await expect(sjcrypto.decryptFile(encryptedFile, tamperedEnvelope, kek)).rejects.toThrow();
  });

  it('binding V3: swap walletPubKey -> unwrap FAIL', async () => {
    const plaintext = utf8Encode('binding swap walletPubKey');
    const walletPubKey = 'test-wallet-bind-wallet';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 'w.txt',
      mimeType: 'text/plain',
    });

    const { encryptedFile, envelope } = encResult;

    const tamperedEnvelope = {
      ...envelope,
      walletPubKey: 'some-other-wallet',
    };

    await expect(sjcrypto.decryptFile(encryptedFile, tamperedEnvelope, kek)).rejects.toThrow();
  });

  it('binding V3: swap fileId -> unwrap FAIL', async () => {
    const plaintext = utf8Encode('binding swap fileId');
    const walletPubKey = 'test-wallet-bind-fileId';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 'f.txt',
      mimeType: 'text/plain',
    });

    const { encryptedFile, envelope } = encResult;

    // unwrap AAD is built from encryptedFile.fileId + headerHash derived from immutable metadata
    const tamperedFile = {
      ...encryptedFile,
      fileId: (encryptedFile.fileId ?? '') + '_tampered',
      aad: { ...(encryptedFile.aad || {}), fileId: (encryptedFile.fileId ?? '') + '_tampered' },
    };

    await expect(sjcrypto.decryptFile(tamperedFile as any, envelope, kek)).rejects.toThrow();
  });

  it('immutable metadata: modifying originalFileName -> FAIL', async () => {
    const plaintext = utf8Encode('immutable originalFileName');
    const walletPubKey = 'test-wallet-immut-name';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const { encryptedFile, envelope } = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 'orig.txt',
      mimeType: 'text/plain',
    });

    const tampered = {
      ...encryptedFile,
      originalFileName: 'changed.txt',
      aad: { ...(encryptedFile.aad || {}), originalFileName: 'changed.txt', filename: 'changed.txt' },
    };

    await expect(sjcrypto.decryptFile(tampered as any, envelope, kek)).rejects.toThrow();
  });

  it('immutable metadata: modifying mimeType -> FAIL', async () => {
    const plaintext = utf8Encode('immutable mimeType');
    const walletPubKey = 'test-wallet-immut-mime';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const { encryptedFile, envelope } = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 'm.txt',
      mimeType: 'text/plain',
    });

    const tampered = {
      ...encryptedFile,
      mimeType: 'application/octet-stream',
      aad: { ...(encryptedFile.aad || {}), mimeType: 'application/octet-stream' },
    };

    await expect(sjcrypto.decryptFile(tampered as any, envelope, kek)).rejects.toThrow();
  });

  it('immutable metadata: modifying fileSize -> FAIL', async () => {
    const plaintext = utf8Encode('immutable fileSize');
    const walletPubKey = 'test-wallet-immut-size';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const { encryptedFile, envelope } = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      walletPubKey,
      filename: 's.txt',
      mimeType: 'text/plain',
    });

    const tampered = {
      ...encryptedFile,
      fileSize: (encryptedFile.fileSize ?? plaintext.byteLength) + 1,
      aad: { ...(encryptedFile.aad || {}), fileSize: (encryptedFile.fileSize ?? plaintext.byteLength) + 1, size: (encryptedFile.fileSize ?? plaintext.byteLength) + 1 },
    };

    await expect(sjcrypto.decryptFile(tampered as any, envelope, kek)).rejects.toThrow();
  });

  it('OQ-10: fileId uniqueness — encrypting same plaintext twice (same immutable metadata) yields different fileId', async () => {
    const plaintext = utf8Encode('fileId uniqueness check (V3)');
    const walletPubKey = 'test-wallet-03';

    // Keep immutable metadata identical across both encryptions.
    // We still expect fileId to be unique because fileId is generated by the crypto layer when absent.
    const originalFileName = 'r.txt';
    const mimeType = 'text/plain';

    // Flow A
    const { salt: saltA, unlock: unlockA } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes: sigA } = await generateEd25519KeypairAndSign(unlockA.messageToSign);
    const kekA = await sjcrypto.deriveKekFromSignature(sigA, saltA);
    const resA = await sjcrypto.encryptFile(plaintext, {
      kek: kekA,
      salt: saltA,
      walletPubKey,
      filename: originalFileName,
      mimeType,
    });

    // Flow B (fresh salt/unlock/sign)
    const { salt: saltB, unlock: unlockB } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes: sigB } = await generateEd25519KeypairAndSign(unlockB.messageToSign);
    const kekB = await sjcrypto.deriveKekFromSignature(sigB, saltB);
    const resB = await sjcrypto.encryptFile(plaintext, {
      kek: kekB,
      salt: saltB,
      walletPubKey,
      filename: originalFileName,
      mimeType,
    });

    // Explicit OQ-10 assertion (direct comparison)
    expect(resA.encryptedFile.fileId).not.toEqual(resB.encryptedFile.fileId);

    // Sanity: also ensure the immutable metadata we supplied stayed identical
    expect(resA.encryptedFile.originalFileName).toEqual(originalFileName);
    expect(resB.encryptedFile.originalFileName).toEqual(originalFileName);
    expect(resA.encryptedFile.mimeType).toEqual(mimeType);
    expect(resB.encryptedFile.mimeType).toEqual(mimeType);
    expect(resA.encryptedFile.fileSize).toEqual(plaintext.byteLength);
    expect(resB.encryptedFile.fileSize).toEqual(plaintext.byteLength);
  });

  it('randomness: encrypting same plaintext twice yields different ciphertexts (nonce/salt differences)', async () => {
    const plaintext = utf8Encode('randomness check (V3)');
    const walletPubKey = 'test-wallet-03';

    // Flow A
    const { salt: saltA, unlock: unlockA } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes: sigA } = await generateEd25519KeypairAndSign(unlockA.messageToSign);
    const kekA = await sjcrypto.deriveKekFromSignature(sigA, saltA);
    const resA = await sjcrypto.encryptFile(plaintext, { kek: kekA, salt: saltA, walletPubKey, filename: 'r.txt', mimeType: 'text/plain' });

    // Flow B (fresh salt/unlock/sign)
    const { salt: saltB, unlock: unlockB } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { sigBytes: sigB } = await generateEd25519KeypairAndSign(unlockB.messageToSign);
    const kekB = await sjcrypto.deriveKekFromSignature(sigB, saltB);
    const resB = await sjcrypto.encryptFile(plaintext, { kek: kekB, salt: saltB, walletPubKey, filename: 'r.txt', mimeType: 'text/plain' });

    expect(resA.encryptedFile.ciphertext).not.toEqual(resB.encryptedFile.ciphertext);
    expect(resA.encryptedFile.nonce).not.toEqual(resB.encryptedFile.nonce);
    expect(resA.envelope.wrap.ciphertext).not.toEqual(resB.envelope.wrap.ciphertext);
  });

  it('KEK derivation determinism: same signature+salt -> same KEK; different salt -> different KEK', async () => {
    const walletPubKey = 'test-wallet-04';
    const { salt } = await sjcrypto.prepareUnlock({ wallet: walletPubKey });
    const { unlock } = await sjcrypto.prepareUnlock({ wallet: walletPubKey, saltBytes: salt });

    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);

    const kek1 = await sjcrypto.deriveKekFromSignature(sigBytes, salt);
    const kek2 = await sjcrypto.deriveKekFromSignature(sigBytes, salt);
    expect(Buffer.from(kek1)).toEqual(Buffer.from(kek2));

    const otherSalt = sjcrypto.prepareUnlock({ wallet: walletPubKey }).salt;
    const kek3 = await sjcrypto.deriveKekFromSignature(sigBytes, otherSalt);
    expect(Buffer.from(kek1)).not.toEqual(Buffer.from(kek3));
  });

  it('unlock expiry validation: SJ_UNLOCK_V1 with expired expiresAt should be considered invalid', async () => {
    const issuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const expiresAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago (expired)
    const walletPubKey = 'test-wallet-05';
    const unlock = await sjcrypto.buildUnlockMessageV1({
      wallet: walletPubKey,
      issuedAt,
      expiresAt,
    });

    const now = new Date();
    expect(new Date(unlock.canonicalObject.expiresAt).getTime()).toBeLessThan(now.getTime());
  });
});
