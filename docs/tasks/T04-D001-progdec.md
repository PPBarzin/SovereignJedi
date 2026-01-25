Sovereign Jedi — ProgDec T04-D001
=================================

ID
--
T04-D001

Décision
--------
Pour la Task 4 (Local encryption pipeline — MVP) nous adoptons les choix suivants, applicables immédiatement à l'implémentation et aux tests :

1. AEAD = `XChaCha20-Poly1305`  
   - Lib : `libsodium-wrappers` (ou `libsodium-wrappers-sumo` si on a besoin de perf/streaming).  
   - Nonce/IV pour chiffrement des fichiers : 24 bytes CSPRNG par chiffrement.

2. Dérivation de la KEK (vault session)  
   - IKM = `SHA-256(signature_bytes)` (on pré‑hash la signature).  
   - HKDF = `HKDF-SHA256(salt, info="SJ-KEK-v1") → 32 bytes`.  
   - KEK maintenue strictement en mémoire pendant la session `VaultUnlocked` et détruite à la fermeture/refresh/disconnect.

3. Salt HKDF  
   - Générer un `salt` aléatoire par `Envelope` (16 or 32 bytes CSPRNG — recommandation operational : 32 bytes si l'empreinte/usage mémoire le permet).  
   - Le `salt` est stocké dans l'envelope (encodé base64). Ce champ n'est pas secret.

4. Encodage / représentation  
   - Tous les champs binaires (`nonce`, `ciphertext`, `tag` si séparé, `salt`, `wrappedFileKey`, etc.) sont encodés en `base64`.  
   - `walletPubKey` reste en `base58`.

5. Tests / CI  
   - Ajout de helpers de test (clé ed25519 de test) pour simuler la signature Phantom dans `test/` uniquement (ne pas packager en prod).  
   - Tests obligatoires : round-trip byte-perfect, tamper tests (ciphertext/envelope), randomness tests (nonce/salt), expiry validation.

Contexte
--------
Task 4 implémente et valide le cœur cryptographique entièrement hors‑réseau : chiffrement local d'un fichier → production d'un objet chiffré (`EncryptedFile`) et d'une `Envelope` protégeant la clé du fichier (`fileKey`) ; la déduction d'accès est contrôlée par la session wallet (signature → KEK). Ceci doit respecter les invariants non négociables du projet (voir `Agent onboarding Pack`) : pas de secrets persistants, wallet = identité, upload bloqué si non `Verified` ET pas `VaultUnlocked`.

Options considérées
-------------------
A. AEAD = `AES-256-GCM` (WebCrypto natif)  
   - Avantages : pas de dépendance externe dans navigateur / Node >=18.  
   - Inconvénients : gestion IV/nonce plus stricte (12 bytes), pas d'extension `XChaCha` avec grands espaces de nonce.

B. AEAD = `XChaCha20-Poly1305` (choisi)  
   - Avantages : grands espaces de nonces (24 bytes), résilience contre mauvais usages d'IV, très adapté pour libsodium.  
   - Inconvénients : dépendance `libsodium-wrappers`.

Raisons du choix
----------------
- Préférence sécurité/praticité : `XChaCha20-Poly1305` apporte une ergonomie cryptographique (nonce large) utile pour éviter classes d'erreurs liées au réemploi d'IV. Le coût d'une dépendance contrôlée (`libsodium-wrappers`) est acceptable pour le MVP côté web + Node.
- Pré‑hash de la signature (SHA‑256) améliore la compatibilité/entropie stable pour HKDF et évite usages ambigus de formats de signature.
- Stocker `salt` dans l'envelope est standard (salt non secret) et permet la dérivation reproduisible du KEK lors du déchiffrement.

Impact
------
Techniques
- Ajout d'une dépendance crypto (`libsodium-wrappers`) dans `packages/crypto`.  
- Implémentation de primitives : génération fileKey, encrypt/decrypt XChaCha20-Poly1305, wrap/unwrap fileKey avec KEK dérivée via HKDF-SHA256.  
- KEK uniquement en mémoire : l'API et `SessionManager` doivent fournir la KEK (ou un getter sécurisé) durant `VaultUnlocked`.

Sécurité / UX
- Respect rigoureux des invariants (no secret at rest).  
- Uploads et opérations sensibles : vérification explicite `IdentityVerified && VaultUnlocked` côté UI + handlers.

Implémentation (attendue)
-------------------------
New files (proposition)
- `packages/crypto/src/localEncryption.ts`  
  - Fonctions exportées :  
    - `buildUnlockMessageV1(params) -> { canonicalObject, messageToSign }`  
    - `deriveKekFromSignature(signatureBytes, saltBytes) -> kekBytes`  
    - `generateFileKey() -> Uint8Array`  
    - `encryptFile(bytes, kek, aad?) -> { encryptedFile, envelope }`  
    - `decryptFile(encryptedFile, envelope, kek) -> Uint8Array`  

- `packages/crypto/src/types.ts`  
  - Types : `EncryptedFilePackage`, `Envelope`, `Header`, `CryptoContext`, `UnlockMessageV1`.

Fonctions utilitaires attendues
- `cryptoGetRandomBytes(len)` (déjà existant dans package) pour nonces/salts.  
- Wrappers libsodium pour XChaCha20-Poly1305 encrypt/decrypt.  
- `sha256(data)` et `deriveKeyHKDF(ikm, salt, info, length)` (présents ou à exposer).  
- Helpers test-only pour signature simulation (ed25519).

Canonical message: SJ_UNLOCK_V1
-------------------------------
But : domain separation, versioning, sérialisation stable.

Canonical JSON object (fields requis)
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

Contraintes
- `origin` = `window.location.origin`.  
- `nonce` = 16 bytes CSPRNG, encodé base64.  
- `issuedAt` = `new Date().toISOString()` (UTC).  
- `expiresAt` = `issuedAt + 10 minutes` (MVP).  
- `vaultId`: stable string (MVP: `"local-default"`).

Sérialisation canonique signée
1. Appliquer JSON Canonicalization Scheme (JCS, RFC 8785) à l'objet :  
   - tri des clés lexicographique, pas d'espaces superflus, encodage UTF-8 strict.  
2. Préfixer la chaîne avec le header fixe :  
   ```
   SJ_UNLOCK_V1\n<JCS_JSON>
   ```
3. Signer la string résultante avec le wallet (Phantom) — signature bytes (`sigBytes`) utilisés ensuite.

Dérivation KEK depuis la signature
- `sigBytes` = signature retournée par le wallet (`Uint8Array`).  
- `ikm = SHA-256(sigBytes)` (pré‑hash).  
- `kek = HKDF-SHA256(ikm, salt=envelope.salt, info="SJ-KEK-v1", length=32)`.

Artefacts de données (format JSON high-level)
- `EncryptedFile` (header + payload)
{
  "version": 1,
  "cipher": "XChaCha20-Poly1305",
  "nonce": "<base64_24bytes>",        // used for file ciphertext
  "ciphertext": "<base64>",
  "aad": { "filename": "string", "size": number, "mimeType"?: "string" }
}

- `Envelope`
{
  "version": 1,
  "walletPubKey": "<base58>",
  "kekDerivation": {
    "method": "wallet-signature",
    "messageTemplateId": "SJ_UNLOCK_V1",
    "salt": "<base64_16or32bytes>",
    "info": "SJ-KEK-v1"
  },
  "wrap": {
    "cipher": "XChaCha20-Poly1305",
    "nonce": "<base64_24bytes>",
    "ciphertext": "<base64>",
    "context": "file-binding-context"
  }
}

Encodage
- Tous les champs binaires en `base64`.  
- `walletPubKey` en `base58`.

API publique proposée (TypeScript)
- `generateFileKey(): Uint8Array`  
- `buildUnlockMessageV1(params): { canonicalObject: UnlockMessageV1, messageToSign: string }`  
- `deriveKekFromSignature(signatureBytes: Uint8Array, saltBytes: Uint8Array): Promise<Uint8Array>`  
- `encryptFile(bytes: Uint8Array, fileKey: Uint8Array, aad?): Promise<{ encryptedFile: EncryptedFile, envelope: Envelope }>`  
- `decryptFile(encryptedFile: EncryptedFile, envelope: Envelope, kek: Uint8Array): Promise<Uint8Array>`

Plan de tests (obligatoire)
---------------------------
Unit tests (`packages/crypto`):
- Round-trip: encryptFile → decryptFile == original bytes (byte-for-byte).  
- Tamper ciphertext: change 1 byte ciphertext -> decrypt must fail.  
- Tamper envelope: change salt/wrap.ciphertext/nonce -> decrypt must fail.  
- Randomness: encrypt same file twice → different ciphertexts (nonce and/or wrap.nonce differ).  
- KEK derivation deterministic: same signature + salt -> same KEK; different signature -> different KEK.  
- Unlock expiry: signature message with `expiresAt` in past -> reject unlock attempt (validation performed before deriving KEK).

Integration / OQ (manual or e2e):
- Wallet connected, `Verified=false` -> upload blocked.  
- `Verified=true && VaultLocked` -> upload blocked.  
- `Verified=true && VaultUnlocked=true` -> client encrypts file then may proceed to upload (upload layer remains out of scope).  
- Refresh or disconnect -> KEK lost -> decrypt impossible without new unlock.

Definition of Done
------------------
- Encryption + envelope + decryption working locally, round-trip verified by tests.  
- Single explicit signature per session unlock; multiple files decryptable without new signature during same `VaultUnlocked` session.  
- Refresh/close tab/ disconnect forces new unlock (KEK not persisted).  
- No secret persisted to storage (localStorage/IndexedDB/sessionStorage).  
- Documentation updated: this ProgDec (`T04-D001`) in `docs/tasks/` and Anytype ProgDec object created & linked to task.  
- Tests green in CI for the crypto package.

Migration / Evolution / Notes
-----------------------------
- `XChaCha20-Poly1305` via libsodium is the chosen default; future work may add `AES-GCM` fallback for light clients or environments where libsodium can't be used.  
- Future features (out of scope MVP): multi-destination envelopes, hardware wallet flows (signing), recovery / re-key strategies.  
- Toute modification structurelle (p.ex. changer le template SJ_UNLOCK_V1, ou fusion Verified/Unlocked) doit être formalisée dans un nouveau ProgDec.

Références
----------
- Agent Onboarding Pack (Anytype) — invariants non négociables.  
- Task 3.5 ProgDec T03-5-D001 — séparation IdentityVerified vs VaultUnlocked.  
- RFC 8785 — JSON Canonicalization Scheme (JCS).  
- libsodium / XChaCha20-Poly1305 documentation.  
- RFC 5869 — HKDF.

Statut
------
Accepted — Effective immediately for Task 4 implementation (branch `task-4-local-encryption-pipeline` to be créée, ProgDec linked to Anytype).

Auteur
------
Sovereign Jedi — Engineering (ProgDec T04-D001)

Date
----
2026-01-25