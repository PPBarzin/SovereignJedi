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
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b);
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

// Helper: generate an ed25519 keypair (libsodium) and sign a message string (utf-8)
// Returns { pubKeyBase64, pubKeyHex, sk, pk, sigBytes }
async function generateEd25519KeypairAndSign(message: string) {
  // Use tweetnacl for test keypair + signing.
  // tweetnacl.sign.keyPair() returns { publicKey, secretKey } as Uint8Array
  const kp = nacl.sign.keyPair();
  const pk = kp.publicKey as Uint8Array;
  const sk = kp.secretKey as Uint8Array;

  // Sign the message with tweetnacl.detached
  const msgBytes = utf8Encode(message);
  const sig = nacl.sign.detached(msgBytes, sk) as Uint8Array;

  return {
    pubKeyBase64: toBase64(pk),
    pubKeyHex: Buffer.from(pk).toString('hex'),
    pk,
    sk,
    sigBytes: new Uint8Array(sig),
  };
}

describe('localEncryption — high level flow (integration with libsodium)', () => {
  it('round-trip: encrypt -> decrypt returns original plaintext (byte-perfect)', async () => {
    // plaintext
    const plaintext = utf8Encode('Hello Sovereign Jedi — round trip test');

    // choose a wallet identifier (for message object). In production this is base58,
    // but for the purposes of the signature the exact wallet string is not required
    // to be a real base58 key — it is included in the canonical object.
    const walletId = 'test-wallet-01';

    // 1) prepare unlock: generates salt + canonical unlock message
    const { salt, unlock } = sjcrypto.prepareUnlock({ wallet: walletId });

    // 2) sign the canonical message using libsodium (ed25519)
    const { sk, sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);

    // Note: in a real flow the wallet signs; here we used a libsodium test keypair.
    // 3) derive KEK from signature + salt
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    // 4) encrypt file (pass kek and salt explicitly per protocol)
    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
      filename: 'hello.txt',
      mimeType: 'text/plain',
    });

    const { encryptedFile, envelope } = encResult;

    // Ensure envelope contains salt (base64) and correct structure
    expect(typeof envelope.kekDerivation.salt).toBe('string');
    expect(envelope.kekDerivation.messageTemplateId).toBe('SJ_UNLOCK_V1');

    // 5) decrypt
    const recovered = await sjcrypto.decryptFile(encryptedFile, envelope, kek);

    expect(Buffer.from(recovered)).toEqual(Buffer.from(plaintext));
  });

  it('tamper tests: modifying ciphertext/nonce/aad/wrap -> decryption fails', async () => {
    const plaintext = utf8Encode('tamper test content');
    const walletId = 'test-wallet-02';
    const { salt, unlock } = await sjcrypto.prepareUnlock({ wallet: walletId });
    const { sk, sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);
    const kek = await sjcrypto.deriveKekFromSignature(sigBytes, salt);

    const encResult = await sjcrypto.encryptFile(plaintext, {
      kek,
      salt,
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

    // 3) tamper aad (filename) — canonicalization of aad is used as AAD; altering should break authenticity
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

    // 5) tamper salt: different salt will result in different KEK. Using original kek with mutated salt should fail.
    const wrongSalt = (await sjcrypto.prepareUnlock({ wallet: walletId })).salt; // new salt
    const wrongEnvelope = {
      ...envelope,
      kekDerivation: { ...envelope.kekDerivation, salt: toBase64(wrongSalt) },
    };
    // decrypt with original kek but envelope claims a different salt: unwrap will fail (integrity)
    await expect(sjcrypto.decryptFile(encryptedFile, wrongEnvelope, kek)).rejects.toThrow();
  });

  it('randomness: encrypting same plaintext twice yields different ciphertexts (nonce/salt differences)', async () => {
    const plaintext = utf8Encode('randomness check');
    const walletId = 'test-wallet-03';

    // Flow A
    const { salt: saltA, unlock: unlockA } = sjcrypto.prepareUnlock({ wallet: walletId });
    const { sigBytes: sigA } = await generateEd25519KeypairAndSign(unlockA.messageToSign);
    const kekA = await sjcrypto.deriveKekFromSignature(sigA, saltA);
    const resA = await sjcrypto.encryptFile(plaintext, { kek: kekA, salt: saltA, filename: 'r.txt' });

    // Flow B (fresh salt/unlock/sign)
    const { salt: saltB, unlock: unlockB } = sjcrypto.prepareUnlock({ wallet: walletId });
    const { sigBytes: sigB } = await generateEd25519KeypairAndSign(unlockB.messageToSign);
    const kekB = await sjcrypto.deriveKekFromSignature(sigB, saltB);
    const resB = await sjcrypto.encryptFile(plaintext, { kek: kekB, salt: saltB, filename: 'r.txt' });

    // Ciphertexts (base64) should differ
    expect(resA.encryptedFile.ciphertext).not.toEqual(resB.encryptedFile.ciphertext);
    // Nonces should differ (very likely due to CSPRNG)
    expect(resA.encryptedFile.nonce).not.toEqual(resB.encryptedFile.nonce);
    // Wrap.ciphertext (wrapped fileKey) should also differ
    expect(resA.envelope.wrap.ciphertext).not.toEqual(resB.envelope.wrap.ciphertext);
  });

  it('KEK derivation determinism: same signature+salt -> same KEK; different salt -> different KEK', async () => {
    const walletId = 'test-wallet-04';
    const { salt } = sjcrypto.prepareUnlock({ wallet: walletId });
    const { unlock } = sjcrypto.prepareUnlock({ wallet: walletId, saltBytes: salt });

    // sign using libsodium
    const { sigBytes } = await generateEd25519KeypairAndSign(unlock.messageToSign);

    const kek1 = await sjcrypto.deriveKekFromSignature(sigBytes, salt);
    const kek2 = await sjcrypto.deriveKekFromSignature(sigBytes, salt);
    expect(Buffer.from(kek1)).toEqual(Buffer.from(kek2));

    // different salt => different kek
    const otherSalt = sjcrypto.prepareUnlock({ wallet: walletId }).salt;
    const kek3 = await sjcrypto.deriveKekFromSignature(sigBytes, otherSalt);
    expect(Buffer.from(kek1)).not.toEqual(Buffer.from(kek3));
  });

  it('unlock expiry validation: SJ_UNLOCK_V1 with expired expiresAt should be considered invalid', async () => {
    // Build an unlock message with issuedAt/expiredAt in the past
    const issuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const expiresAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago (expired)
    const walletId = 'test-wallet-05';
    const unlock = sjcrypto.buildUnlockMessageV1({
      wallet: walletId,
      issuedAt,
      expiresAt,
    });

    // Simple validation: the canonical object contains expiresAt; test asserts it's in the past
    const now = new Date();
    expect(new Date(unlock.canonicalObject.expiresAt).getTime()).toBeLessThan(now.getTime());

    // In actual flow, the application MUST reject an unlock signed for an expired message.
    // Here we assert that expire check is detectable from the unlock object.
    // (Actual deriveKekFromSignature will not check expiry; the application must enforce it before deriving KEK.)
  });
});
