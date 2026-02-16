declare module 'libsodium-wrappers-sumo' {
  /**
   * Minimal TypeScript declarations for `libsodium-wrappers-sumo`
   * (keeps typing light while providing the functions used by Task 4).
   *
   * This file purposefully exposes a small surface required by the code:
   * - ready (Promise) to await WASM initialization
   * - randombytes_buf
   * - AEAD XChaCha20-Poly1305 encrypt/decrypt helpers
   * - signing helpers used in tests
   *
   * If you need additional functions, extend this declaration with the exact
   * signatures from libsodium documentation.
   */

  const sodium: {
    // Promise that resolves when libsodium is initialized (WASM ready)
    ready: Promise<void>;

    // Random bytes generator
    randombytes_buf(length: number): Uint8Array;

    // XChaCha20-Poly1305 AEAD (libsodium-wrappers naming)
    // encrypt(message, additionalData, nsec|null, nonce, key) -> ciphertext (Uint8Array)
    crypto_aead_xchacha20poly1305_ietf_encrypt(
      message: Uint8Array,
      additionalData: Uint8Array | null,
      nsec: any | null,
      nonce: Uint8Array,
      key: Uint8Array
    ): Uint8Array;

    // decrypt(nsec|null, ciphertext, additionalData|null, nonce, key) -> plaintext Uint8Array | null
    crypto_aead_xchacha20poly1305_ietf_decrypt(
      nsec: any | null,
      ciphertext: Uint8Array,
      additionalData: Uint8Array | null,
      nonce: Uint8Array,
      key: Uint8Array
    ): Uint8Array | null;

    // Signing helpers (ed25519)
    crypto_sign_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
    crypto_sign_detached(message: Uint8Array, sk: Uint8Array): Uint8Array;
    crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, pk: Uint8Array): boolean;

    // Generic hash (optional, helpful for tests/derivation)
    crypto_generichash?(length: number, input: Uint8Array): Uint8Array;

    // Utility encoders/decoders (optional)
    to_base64?(input: Uint8Array, variant?: number): string;
    from_base64?(input: string, variant?: number): Uint8Array;
  };

  export default sodium;
}
