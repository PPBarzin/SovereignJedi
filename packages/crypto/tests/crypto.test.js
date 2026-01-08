import { describe, it, expect } from 'vitest';
import { deriveKeyHKDF, toHex, utf8Encode, runSelfTest, generateAesKey, exportAesKey, importAesKey, encryptAesGcm, decryptAesGcm, sha256 } from '../src/index';
describe('@sj/crypto - primitives', () => {
    it('hkdf derives deterministic output for same inputs', async () => {
        const ikm = utf8Encode('seed-material');
        const salt = utf8Encode('somesalt');
        const info = utf8Encode('sj:episode1:test');
        const a = await deriveKeyHKDF(ikm, salt, info, 32);
        const b = await deriveKeyHKDF(ikm, salt, info, 32);
        expect(toHex(a)).toEqual(toHex(b));
    });
    it('sha256 produces expected length and deterministic value', async () => {
        const data = utf8Encode('hello world');
        const hash = await sha256(data);
        expect(hash).toBeInstanceOf(Uint8Array);
        expect(hash.length).toBe(32); // SHA-256 length
        // deterministic check: second call equals first
        const hash2 = await sha256(data);
        expect(toHex(hash)).toEqual(toHex(hash2));
    });
    it('AES-GCM encrypt/decrypt roundtrip with generated CryptoKey', async () => {
        const key = await generateAesKey();
        const plaintext = utf8Encode('sensitive payload for testing');
        const { iv, ciphertext } = await encryptAesGcm(key, plaintext);
        const decrypted = await decryptAesGcm(key, iv, ciphertext);
        expect(new TextDecoder().decode(decrypted)).toEqual('sensitive payload for testing');
    });
    it('exported raw key can be re-imported and used to decrypt', async () => {
        const key = await generateAesKey();
        const raw = await exportAesKey(key);
        // import into a new CryptoKey
        const imported = await importAesKey(raw);
        const plaintext = utf8Encode('roundtrip with raw key');
        const { iv, ciphertext } = await encryptAesGcm(imported, plaintext);
        const decrypted = await decryptAesGcm(imported, iv, ciphertext);
        expect(new TextDecoder().decode(decrypted)).toEqual('roundtrip with raw key');
    });
    it('runSelfTest returns expected decrypted text', async () => {
        const res = await runSelfTest();
        expect(res).toHaveProperty('hkdfDerivedHex');
        expect(res).toHaveProperty('encryptedHex');
        expect(res).toHaveProperty('decryptedText');
        expect(res.decryptedText).toBe('hello sovereign jedi');
    });
});
