/**
 * packages/crypto/tests/localEncryption.test.ts
 *
 * Tests for the local encryption pipeline (Task 4) — unit/integration style using real libsodium.
 *
 * This test file:
 *  - exercises the prepareUnlock / buildUnlockMessageV1 → sign → deriveKekFromSignature → encryptFile → decryptFile flow
 *  - includes a small test helper that uses libsodium to generate an ed25519 keypair and sign the canonical SJ_UNLOCK_V1 message
 *
 * Notes:
 *  - These tests require `libsodium-wrappers` to be available (installed as a dependency of the package).
 *  - The localEncryption implementation returns `fileKey` only in test environments (NODE_ENV === 'test').
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as sodium from 'libsodium-wrappers';

// Import the high-level crypto API from the package's src index.
// The index re-exports the Task 4 functions (buildUnlockMessageV1, prepareUnlock, deriveKekFromSignature, encryptFile, decryptFile)
import * as sjcrypto from '../src';

const utf8Encode = (s: string) => new TextEncoder().encode(s);
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b);
const toBase64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

beforeAll(async () => {
  // Ensure libsodium is ready before running tests
  await sodium.ready;
});

// Helper: generate an ed25519 keypair (libsodium) and sign a message string (utf-8)
// Returns { pubKeyBase64, pubKeyHex, sk, pk, sigBytes }
async function generateEd25519KeypairAndSign(message: string) {
  // libsodium.keypair returns Uint8Array for public/secret keys
  const kp = sodium.crypto_sign_keypair();
  const pk = kp.publicKey as Uint8Array;
  const sk = kp.privateKey as Uint8Array;

  // Sign the message deterministically with crypto_sign_detached
  const msgBytes = utf8Encode(message);
  const sig = sodium.crypto_sign_detached(msgBytes, sk) as Uint8Array;

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
    const { salt, unlock } = sjcrypto.prepareUnlock({ wallet: walletId });
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
    const wrongSalt = sjcrypto.prepareUnlock({ wallet: walletId }).salt; // new salt
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
