Sovereign Jedi — ProgDec T04-D002
=================================

ID
--
T04-D002

Titre
-----
Wrap AAD Binding V2 + walletPubKey requis dans encryptFile (Task 4)

Statut
------
Superseded / Deprecated (par T04-D003)

Décision
--------
⚠️ **Ce ProgDec est déprécié.** Il est **remplacé** par `T04-D003` (Wrap AAD Binding V3 — `headerHash` sur subset immutable).

Raison :
- Le binding V2 (AAD = `{ v: 2, salt, walletPubKey, fileId }`) a été superseded par le binding V3 qui ajoute `headerHash` (métadonnées immuables) dans le wrap AAD.
- La règle officielle est désormais **V3 uniquement** (pas de fallback V1/V2).

Historique (conservé pour traçabilité) :
- V2 introduisait un AAD canonique pour le wrap/unwrap de `fileKey` afin de binder `salt`, `walletPubKey` et `fileId`.
- V2 rendait aussi `walletPubKey` obligatoire dans `encryptFile()`.

Contexte
--------
La Task 4 (Local encryption pipeline — MVP) impose :
- AEAD `XChaCha20-Poly1305` (libsodium),
- une `fileKey` unique par fichier,
- une `Envelope` contenant `salt` (HKDF) et `walletPubKey`,
- aucune persistance de secrets,
- un flux strict offline.

Lors de l’audit Phase A, le wrap AAD était une constante (`"file-binding-context"`), ce qui :
- assure l’intégrité AEAD du wrap en tant que tel,
- mais ne protège pas contre des erreurs d’assemblage (ex: envelope associée au mauvais fichier, ou au mauvais walletPubKey) au niveau applicatif, si des champs sont remplacés / mixés par erreur dans les couches supérieures.

Objectifs
---------
1) Renforcer l’intégrité de l’assemblage envelope ↔ wrap ↔ file.
2) Faire échouer explicitement toute incohérence détectable (salt/walletPubKey/fileId/version).
3) Éliminer l’API fragile où `Envelope.walletPubKey` peut être laissé vide.

Portée (scope)
--------------
IN (autorisé)
- Modification minimale du protocole de wrap AAD : passage V1 → V2.
- Mise à jour types + API `encryptFile()` : `walletPubKey` requis.
- Mise à jour des tests unitaires dans `packages/crypto` (obligatoires).
- Ajustement minimal du “CryptoSmoke CDN fallback” pour qu’il soit **désactivé en production** et **uniquement activable via flag DEV explicite**.

OUT (interdit)
- Refactor large.
- Extension de scope (nouveaux modules, nouvelle architecture, nouveaux formats non requis).
- Modifications hors `packages/crypto` sauf la neutralisation minimale du fallback CDN du smoke.
- Toute persistance de secrets (KEK, fileKey, seed, etc.).

Delta protocolaire (Wrap AAD Binding V2)
----------------------------------------
Nous définissons un AAD V2 **canonique** (RFC 8785 via `canonicalize`) pour le wrap AEAD de la `fileKey`.

Format (objet canonique) :
- AAD_OBJ_V2 = canonicalize({
    v: 2,
    salt: base64(salt),
    walletPubKey,
    fileId
  })

Encodage :
- `wrapAadBytes = utf8Encode(AAD_OBJ_V2)`

Usage :
- wrap (encrypt) : `crypto_aead_xchacha20poly1305_ietf_encrypt(fileKey, wrapAadBytes, null, wrapNonce, kek)`
- unwrap (decrypt) : `crypto_aead_xchacha20poly1305_ietf_decrypt(null, wrappedCiphertext, wrapAadBytes, wrapNonce, kek)`

Contraintes
-----------
- `v` DOIT être `2` (version explicite, non optionnelle).
- `salt` DOIT correspondre au `salt` utilisé lors de la dérivation HKDF (stocké dans `envelope.kekDerivation.salt`, encodé base64).
- `walletPubKey` DOIT correspondre à l’identité wallet associée à l’envelope.
- `fileId` DOIT être un identifiant stable du fichier chiffré (ou un hash canonique stable du header).
- Tout mismatch DOIT provoquer un échec d’unwrap (AEAD authenticity failure) et donc bloquer le déchiffrement du fichier.

Compatibilité V1
----------------
Règle :
- Si aucune donnée persistée réelle en V1 n’existe (MVP non encore en prod), V1 peut être abandonné.
- Sinon : supporter V1 en **lecture uniquement**.

Décision opérationnelle :
- Nous implémentons **V2 en écriture** (encryption/wrap).
- Nous supportons **V1 en lecture uniquement** si nécessaire, via logique de fallback contrôlée :
  - Si `envelope.wrap.context` ou indicateur de version AAD indique V1, utiliser l’ancien AAD constant (`"file-binding-context"`).
  - Sinon utiliser V2.
- Cette compatibilité ne doit pas étendre le scope au-delà du strict nécessaire.

Changement API (walletPubKey requis)
------------------------------------
Nous modifions l’API `encryptFile()` (export public) pour rendre `walletPubKey` obligatoire :

Avant (V1) :
- `encryptFile(plaintext, { kek, salt, filename?, mimeType?, fileKey? })`

Après (V2) :
- `encryptFile(plaintext, { kek, salt, walletPubKey, fileId?, filename?, mimeType?, fileKey? })`

Contraintes :
- `walletPubKey` requis : throw explicite si absent/empty.
- Interdit de produire une envelope avec `walletPubKey === ""`.
- `fileId` requis pour Wrap AAD V2 (soit fourni directement, soit dérivé d’un header canonique stable).
  - Pour minimiser le scope, la préférence est : `fileId` généré au moment de l’encryption, stocké en clair dans `EncryptedFile`/header non sensible, et réutilisé au wrap/unwap.

Tests obligatoires (packages/crypto)
------------------------------------
Ajouter/mettre à jour des tests unitaires pour couvrir :

1) Round-trip V2 OK
- encrypt(V2) → decrypt(V2) retourne bytes identiques.

2) Swap salt → unwrap FAIL
- modifier `envelope.kekDerivation.salt` (ou la valeur utilisée pour reconstruire AAD) doit provoquer l’échec.

3) Swap walletPubKey → unwrap FAIL
- modifier `envelope.walletPubKey` doit provoquer l’échec.

4) Swap fileId/header → unwrap FAIL
- modifier le `fileId` (ou le hash stable du header) doit provoquer l’échec.

5) API guard
- `encryptFile()` sans `walletPubKey` DOIT throw.

CryptoSmoke CDN (réseau)
------------------------
Décision :
- Le fallback CDN est neutralisé par défaut.
- Il est autorisé UNIQUEMENT si un flag DEV explicite est activé (ex: `NEXT_PUBLIC_SMOKE_ALLOW_CDN === "1"`).
- En production (ou sans flag), aucun appel réseau implicite ne doit se produire.

Raison
------
- Binding V2 : réduit le risque d’erreurs d’assemblage envelope ↔ fichier, et durcit le protocole sans introduire de nouveaux secrets persistants.
- walletPubKey requis : force la complétude des artefacts et supprime un piège d’intégration.
- Neutralisation CDN : respecte la contrainte “pas de réseau implicite” et garde un outil DEV optionnel.

Impact
------
Sécurité
- Améliore l’intégrité protocolaire et réduit les classes d’erreurs “mix and match” entre enveloppes et fichiers.
- Ne change pas le modèle de menace fondamental (un client compromis reste out of scope).

Compatibilité
- Potentiel impact sur artefacts déjà persistés (V1). La compatibilité V1 en lecture uniquement est prévue si nécessaire.

DX / UX
- L’appelant doit fournir `walletPubKey` (et `fileId` si non dérivé) — légère friction mais réduction de bugs.

Implémentation (plan minimal)
-----------------------------
- `packages/crypto/src/v0_local_encryption/localEncryption.ts`
  - Générer/porter `fileId` dans `EncryptedFile` (header non secret) ou l’accepter en param.
  - Construire `wrapAadBytes` via canonicalize(AAD_OBJ_V2) en V2.
  - `encryptFile()` : exiger `walletPubKey` + renseigner `envelope.walletPubKey`.
  - `decryptFile()` : reconstruire wrap AAD V2 avec `salt + walletPubKey + fileId + v=2` et unwrap.

- `packages/crypto/src/v0_local_encryption/types.ts`
  - Ajouter `fileId` (champ non sensible) dans le type `EncryptedFile` ou type header.
  - Rendre `walletPubKey` obligatoire dans les options de `encryptFile`.

- `packages/crypto/tests/localEncryption.test.ts`
  - Mettre à jour les appels encryptFile avec walletPubKey.
  - Ajouter tests swap salt / swap walletPubKey / swap fileId.

- `apps/web` (modification minimale smoke uniquement)
  - Désactiver fallback CDN sauf flag DEV explicite.

Sécurité — invariants rappelés
------------------------------
- Aucune clé privée/seed/KEK/fileKey ne doit être persistée (localStorage, sessionStorage, IndexedDB, fichiers, logs).
- Pas de backend d’auth.
- Offline-first.
- Upload gated par Verified && VaultUnlocked (hors scope correction crypto, mais invariant global maintenu).

Auteur
------
Sovereign Jedi — Engineering

Date
----
2026-02-16