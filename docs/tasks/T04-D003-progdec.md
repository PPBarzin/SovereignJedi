Sovereign Jedi — ProgDec T04-D003
=================================

ID
--
T04-D003

Titre
-----
Wrap AAD Binding V3 — headerHash sur subset immutable (Task 4)

Statut
------
Proposed

Décision
--------
Nous faisons évoluer le protocole de binding wrap/envelope de la Task 4 vers une **version V3** afin de garantir que certaines métadonnées du package chiffré sont **immutables au sens cryptographique** et que toute altération casse le déchiffrement.

Concrètement :
1) Nous définissons un `headerImmutableSubset` (non secret) comprenant :
   - `originalFileName`
   - `mimeType`
   - `fileSize`
   - `fileId` (artefact technique crypto)

2) Nous calculons un `headerHash` :
   - `headerHash = SHA-256( canonicalize(headerImmutableSubset) )`
   - `canonicalize` = JSON Canonicalization Scheme (RFC 8785) via la lib `canonicalize`.
   - Encodage du canonique en UTF-8 avant SHA-256.

3) Nous intégrons `headerHash` dans le wrap AAD (V3) :
   - `wrapAAD = canonicalize({ v: 3, salt, walletPubKey, fileId, headerHash })`
   - Encodage UTF-8 et passage en AAD à libsodium AEAD:
     - `crypto_aead_xchacha20poly1305_ietf_encrypt(...)`
     - `crypto_aead_xchacha20poly1305_ietf_decrypt(...)`

4) Nous ne stockons **pas** `headerHash` séparément dans les artefacts persistés.
   - Il est **recalculé dynamiquement** à partir du header présent dans le package au moment du decrypt.
   - L’objectif est d’éviter la duplication et de réduire les risques d’incohérences.

Décisions d’architecture actées (rappel)
----------------------------------------
Décision 1 — V2 uniquement (historique)
- Nous confirmons qu’aucun artefact V1 n’est stocké.
- Aucune compatibilité V1 n’est requise.
- Aucun fallback V1 en lecture n’est implémenté.

Décision 2 — fileId = artefact technique crypto
- `fileId` appartient au layer crypto.
- Il est généré par le pipeline si absent.
- Ce n’est pas un identifiant métier.
- Il reste bindé dans le wrap AAD.

Décision 3 — Metadata immuables cassent le decrypt
Les métadonnées suivantes font partie de l’intégrité :
- `originalFileName`
- `mimeType`
- `fileSize`
- `fileId`

Toute modification de l’une de ces valeurs dans le package doit rendre `unwrap/decrypt` impossible (échec AEAD).

Contexte
--------
La Task 4 définit un pipeline local de chiffrement avec envelope :
- AEAD : XChaCha20-Poly1305 via `libsodium-wrappers-sumo` (fail hard, pas de fallback).
- Une clé `fileKey` unique par fichier.
- Protection de `fileKey` par wrap AEAD via KEK dérivée (signature wallet → SHA-256 → HKDF).

Lors des itérations précédentes, le wrap AAD assurait un binding avec `salt`, `walletPubKey` et `fileId`.
Ce ProgDec ajoute un binding explicite des métadonnées considérées immuables, via un hash canonique (`headerHash`) recalculé à la volée, garantissant que toute altération est détectée cryptographiquement.

Objectifs
---------
- Garantir l’intégrité cryptographique des métadonnées immuables sans stocker de secrets.
- Empêcher les erreurs d’assemblage ou les modifications non détectées des champs immuables.
- Maintenir un delta minimal, sans élargissement de scope.

Portée (scope)
--------------
IN (autorisé)
- Changements minimaux **dans `packages/crypto`** uniquement :
  - Ajout/restructuration minimale du header pour exposer `originalFileName`, `mimeType`, `fileSize`, `fileId` en clair (non secret).
  - Calcul `headerHash` par SHA-256 sur canonicalize(headerImmutableSubset).
  - Wrap AAD V3 incluant `headerHash`.
  - Mise à jour des tests unitaires obligatoires.

OUT (interdit)
- Refactor UI / UX.
- Ajout d’un backend.
- Persistance de secrets (KEK, fileKey, seed, signature).
- Ajout de compat V1 en lecture.
- Extension de protocole non requise.

Delta protocolaire (V3)
-----------------------
Nouveaux calculs :

A) Subset immutable
- headerImmutableSubset = {
    originalFileName,
    mimeType,
    fileSize,
    fileId
  }

B) Hash canonique
- headerHash = SHA-256( utf8Encode( canonicalize(headerImmutableSubset) ) )

C) Wrap AAD (V3)
- wrapAAD = canonicalize({
    v: 3,
    salt,
    walletPubKey,
    fileId,
    headerHash
  })

- Le champ `salt` est celui stocké dans `envelope.kekDerivation.salt` (base64).
- `headerHash` est encodé de manière stable (recommandation : base64 du digest SHA-256) avant inclusion dans l’objet canonicalisé.

Règles
------
- `v` DOIT être 3.
- `headerHash` NE DOIT PAS être persisté comme champ dédié.
- `headerHash` DOIT être recalculé au decrypt à partir des champs présents.
- Toute altération de `originalFileName`, `mimeType`, `fileSize`, `fileId` doit casser l’unwrap (AEAD auth fail).

Tests obligatoires (packages/crypto)
------------------------------------
Ajouter/mettre à jour les tests unitaires pour couvrir :

1) Round-trip complet → OK
- encrypt → decrypt = bytes identiques.

2) Modification originalFileName → FAIL
- changer `originalFileName` dans le package (header/AAD) doit provoquer l’échec.

3) Modification mimeType → FAIL
- changer `mimeType` dans le package doit provoquer l’échec.

4) Modification fileSize → FAIL
- changer `fileSize` dans le package doit provoquer l’échec.

(NB: `fileId` est déjà bindé ; sa modification doit également casser l’unwrap, mais ce test peut exister déjà. Il reste pertinent.)

Sécurité — invariants (rappel)
------------------------------
- Aucune donnée en clair ne doit quitter le device (Task 4 offline).
- Aucun secret persistant : pas de KEK/fileKey/seed/signature en storage.
- Pas de logs contenant des secrets.
- Upload gating Verified && VaultUnlocked reste un invariant global, mais ce ProgDec ne change pas l’UI.

Implémentation (plan minimal)
-----------------------------
- Dans `packages/crypto` :
  - Introduire/standardiser un header non secret contenant :
    - originalFileName
    - mimeType
    - fileSize
    - fileId
  - Calculer `headerHash` à partir de ces champs (canonicalize + SHA-256).
  - Construire wrapAAD V3 avec { v:3, salt, walletPubKey, fileId, headerHash }.
  - Utiliser wrapAAD V3 en wrap et unwrap.
  - Mettre à jour les tests.

Raison
------
- Les métadonnées immuables doivent être protégées par l’authenticité AEAD pour garantir que les artefacts stockés ne peuvent pas être modifiés sans détection.
- `headerHash` recalculé évite la duplication et diminue les risques d’incohérences.

Impact
------
- Renforcement du binding envelope ↔ wrap ↔ header.
- Décryptage échoue si metadata immuable altérée, conformément aux règles actées.
- Aucun changement UI requis.
- Aucun secret additionnel, aucune persistance de secret.

Auteur
------
Sovereign Jedi — Engineering

Date
----
2026-02-16