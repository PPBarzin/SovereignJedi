# Task 04 — Local encryption pipeline (MVP)

Résumé
------
Ce document décrit l'implémentation opérationnelle et les exigences à respecter pour la Task 4 — Local encryption pipeline — conformément à la ProgDec `T04-D001`. Il complète et formalise le flux cryptographique, les exigences de sécurité et le protocole de validation (unitaires + smoke runtime navigateur) nécessaires avant d'exposer l'API publique.

Décision centrale (rappel)
--------------------------
- Cryptographie AEAD : XChaCha20-Poly1305 (libsodium).
- Bibliothèque unique exigée : `libsodium-wrappers-sumo` (WASM build). Si elle n'est pas disponible, l'application doit échouer explicitement (fail hard). Aucune logique de repli (tweetnacl ou autre) n'est acceptée pour la Task 4.
- Sérialisation du message d'unlock : JSON canonicalization (RFC 8785 — JCS strict).
- Flow crypto impératif (non négociable) : prepareUnlock → signature wallet → deriveKEK(signature, salt) → encryptFile({ kek, salt }) → persist { EncryptedFile, Envelope }.
- Aucune clé secrète ni donnée sensible (seed, fileKey, KEK) ne doit être persistée sur disque ou dans des stores permanents.

Artefacts (formats JSON high-level)
----------------------------------
- `EncryptedFile` (extrait)
  - version: 1
  - cipher: "XChaCha20-Poly1305"
  - nonce: "<base64_24bytes>"
  - ciphertext: "<base64>"
  - aad: { filename, size, mimeType } (optionnel, non secret)

- `Envelope` (extrait)
  - version: 1
  - walletPubKey: "<base58>"
  - kekDerivation: { method: "wallet-signature", messageTemplateId: "SJ_UNLOCK_V1", salt: "<base64_16or32>" , info: "SJ-KEK-v1" }
  - wrap: { cipher: "XChaCha20-Poly1305", nonce: "<base64_24>", ciphertext: "<base64>", context: "file-binding-context" }

Remarques :
- Tous les champs binaires sont encodés en `base64`.
- `walletPubKey` est en `base58`.
- L'envelope DOIT contenir le `salt` utilisé pour HKDF ; ce champ est non secret (stocké en clair).
- Ne pas stocker de fingerprint KEK dans l'envelope persistée.

Message canonique — SJ_UNLOCK_V1 (structure)
-------------------------------------------
Le message à signer pour déverrouiller la session (vault unlock) est un objet JSON strictement canoniquement sérialisé (JCS RFC 8785).

Objet canonique (tous champs requis) :
{
  "sj": "SovereignJedi",
  "ver": "1",
  "type": "UNLOCK",
  "origin": "<window.location.origin>",
  "wallet": "<base58_pubkey>",
  "nonce": "<base64_16bytes_random>",
  "issuedAt": "<ISO-8601 UTC timestamp>",
  "expiresAt": "<ISO-8601 UTC timestamp>",
  "vaultId": "<string stable, ex: 'local-default'>"
}

Contraintes :
- `nonce` : 16 octets CSPRNG, base64.
- `issuedAt` : ISO-8601 UTC (`new Date().toISOString()`).
- `expiresAt` : `issuedAt + 10 minutes` (MVP).
- Sérialisation signée : `messageToSign = "SJ_UNLOCK_V1\n" + JCS_SERIALIZED_JSON`.
- La signature produite par le wallet (signature bytes) est l'entrée au pré-hash pour la dérivation KEK.

Dérivation de la KEK (vault session)
------------------------------------
- `sigBytes` = bytes de la signature retournée par le wallet (Uint8Array).
- `ikm = SHA-256(sigBytes)` (pré-hash).
- `kek = HKDF-SHA256(ikm, salt, info="SJ-KEK-v1", length=32)` — retourne 32 octets.
- Le `salt` est généré par le client (16 ou 32 bytes CSPRNG) AVANT la signature et inclus dans l'envelope persistée.

API interne (fonctionnalités exigées)
------------------------------------
Les fonctions attendues (implémentation interne dans `packages/crypto`):
- `prepareUnlock(params) -> { salt: Uint8Array, unlock: UnlockMessageV1, messageToSign: string }`
  - génère `salt` et l'objet canonique `UnlockMessageV1` + `messageToSign`.
- `deriveKekFromSignature(signatureBytes, saltBytes) -> Promise<Uint8Array>`
  - retourne KEK 32 bytes.
- `generateFileKey() -> Uint8Array` (32 bytes, test only).
- `encryptFile(plaintext, { kek, salt, filename?, mimeType? }) -> { encryptedFile, envelope }`
  - exige `kek` et `salt` fournis par l'appelant.
  - utilise libsodium XChaCha20-Poly1305 AEAD, passe `aad` via l'API AEAD (pas de concaténation manuelle).
- `decryptFile(encryptedFile, envelope, kek) -> Uint8Array`
  - unwrap fileKey via KEK (AEAD), déchiffre le fichier via fileKey.

Contraintes d'implémentation (sécurité)
--------------------------------------
- KEK et fileKey : strictement en mémoire. La fermeture onglet / refresh / disconnect doit invalider KEK.
- Pas de persistance de secrets dans : localStorage, sessionStorage, IndexedDB, fichiers.
- Aucune implémentation maison d'AAD ou d'AEAD ; utiliser uniquement l'API libsodium `crypto_aead_xchacha20poly1305_ietf_*`.
- Si `libsodium-wrappers-sumo` n'est pas chargé, l'appel doit throw une erreur explicite (fail hard).
- Tests et helpers de dev peuvent exposer fileKey mais seulement dans des contextes test (`NODE_ENV === 'test'` ou fichiers test internes). Ne pas exposer ces helpers via l'API publique.

Procédure exacte (flow d'utilisation)
------------------------------------
1. Client : `const { salt, unlock } = prepareUnlock({ wallet, origin, vaultId })`.
2. Client (wallet) : signer `unlock.messageToSign` → `sigBytes`.
   - Note : le wallet réel signe la chaîne (Phantom / Solana wallet).
3. Client : `kek = await deriveKekFromSignature(sigBytes, salt)`.
4. Client : `const { encryptedFile, envelope } = await encryptFile(fileBytes, { kek, salt, filename, mimeType })`.
5. Avant persistance, remplir `envelope.walletPubKey = walletPubKey` (base58).
6. Persister `{ encryptedFile, envelope }` côté client/flow d'upload.
7. Pour déchiffrement local : requérir `VaultUnlocked` (re-derive kek via signature flow) puis `decryptFile(encryptedFile, envelope, kek)`.

Tests & CI (obligatoire)
------------------------
- Unitaires (`packages/crypto`):
  - Round-trip: encrypt → decrypt → bytes identiques.
  - Tamper tests: modifier 1 octet du ciphertext/nonce/aad/wrap/salt doit échouer.
  - Randomness: chiffrer deux fois le même fichier doit produire ciphertext différents (nonce aléatoire).
  - KEK determinism: même signature + même salt → même KEK ; même signature + différent salt -> différent KEK.
  - Expiry: construire `SJ_UNLOCK_V1` avec `expiresAt` passé doit être détectable et refusé par l'application avant deriveKEK.
- Smoke runtime navigateur (apps/web) : indispensable avant export public
  - Composant / page “Crypto smoke” :
    - Au clic :
      - dynamique import('libsodium-wrappers-sumo'), await ready.
      - générer 1KB random, `fileKey` 32 bytes.
      - chiffrer with libsodium XChaCha20-Poly1305 (fileKey) with some AAD.
      - unwrap/wrap simulation using a test signature-derived KEK (pour valider WASM), ou simplement test encrypt/decrypt with same fileKey to prove WASM works.
      - comparer bytes et afficher `OK` ou `FAIL` + log détaillé en cas d'erreur.
    - L'objectif : valider que `libsodium` WASM se charge dans un contexte navigateur réel et que l'AEAD fonctionne (encrypt/decrypt).
  - Implementation recommendation (very small helper):
```/dev/null/apps/web-smoke-example.js#L1-200
// PSEUDO-CODE (place in apps/web/src/components/CryptoSmoke.tsx or similar)
//
// onClick -> async:
//
// const mod = await import('libsodium-wrappers-sumo');
// const sodium = mod && mod.default ? mod.default : mod;
// await sodium.ready;
//
// const plaintext = crypto.getRandomValues(new Uint8Array(1024)); // 1KB
// const fileKey = sodium.randombytes_buf(32);
// const nonce = sodium.randombytes_buf(24);
// const aadBytes = new TextEncoder().encode(JSON.stringify({ smoke: true }));
//
// const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aadBytes, null, nonce, fileKey);
// const recovered = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aadBytes, nonce, fileKey);
//
// if (recovered && compareUint8Arrays(recovered, plaintext)) {
//   show("SMOKE OK");
// } else {
//   show("SMOKE FAIL - details in console");
// }
```
  - The smoke must run in a real browser tab (not only SSR) to validate WASM load.

Docs / ProgDec update (T04-D001)
-------------------------------
- `T04-D001` doit être mis à jour (Anytype + repo) pour indiquer :
  - libsodium-only mandate (`libsodium-wrappers-sumo`).
  - flow exact (prepareUnlock → sign → deriveKEK(sig,salt) → encryptFile({kek,salt})).
  - JCS RFC8785 for `SJ_UNLOCK_V1`.
  - No secrets persisted.
- Ce fichier (`docs/tasks/task-04.md`) est la version repo de la Task 4 doc (à joindre à l'objet Anytype).

Installation requise
-------------------
- Package requis pour dev/build/test :
  - `pnpm add -w libsodium-wrappers-sumo --filter @sj/crypto`
  - S'assurer que `apps/web` runtime inclut `libsodium-wrappers-sumo` si la page smoke ou l'usage client importe libsodium à runtime.
- CI / environnements de build :
  - Must support WASM resource resolution (Next/Vite usually handle it) ; si problème, configure la copie du fichier WASM dans le build output ou utilisez dynamic import as shown.

Checklist Definition of Done (DoD)
----------------------------------
- [ ] Unit tests (packages/crypto) verts : round-trip, tamper, randomness, KEK determinism, expiry detection.
- [ ] Build `apps/web` successful (pnpm -C apps/web build).
- [ ] Smoke runtime web test executes in browser: load libsodium WASM, encrypt 1KB, decrypt, compare → OK.
- [ ] ProgDec `T04-D001` mis à jour et lié à l'objet Anytype.
- [ ] Document `docs/tasks/task-04.md` (ce fichier) présent dans le repo.
- [ ] Aucun secret persistent dans le code/commits.
- [ ] Préparer l'export public (B) — différé jusqu'au succès du smoke runtime.

Notes d'évolution (post‑MVP)
---------------------------
- Après validation runtime navigateur (smoke OK), on effectuera :
  - B — exposer l'API Task4 de manière stable via `@sj/crypto` entrypoint et migrer tests pour importer depuis l'entrypoint.
  - Documenter la migration pour clients existants.
  - Étudier mode d'intégration pour hardware wallets (signature flow) et recovery strategies (out of scope MVP).

Contacts & références
---------------------
- ProgDec T04-D001 (Anytype + docs/tasks/T04-D001-progdec.md)
- RFC 8785 — JSON Canonicalization Scheme (JCS)
- RFC 5869 — HKDF
- libsodium / libsodium-wrappers-sumo documentation

Version & auteur
----------------
- Auteur : Sovereign Jedi — Engineering  
- Date : 2026-01-25
