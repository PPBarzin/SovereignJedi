---
# yaml-language-server: $schema=schemas/page.schema.json
Object type:
  - ProgDec
Task: 6 — Manifest v1 (user data layer)
Status: Proposed
Creation date: "2026-02-17T00:00:00Z"
---

# ProgDec — Task 06 (Manifest v1 / user data layer)

Ce document trace les décisions de programmation significatives pour la Task 6.

---

## T06-D001 — Pointeur de manifest stocké en local par wallet (MVP)

- **Décision** : Le `manifestCid` est stocké en local, clé `sj:manifestCid:<walletPubKey>`, via `localStorage` (MVP).
- **Contexte** : Le manifest est sur IPFS, mais il faut un pointeur “wallet can open” pour retrouver le dernier CID. Le MVP n’implémente pas de pointeur on-chain/IPNS.
- **Options considérées** :
  - A) Pointeur local (localStorage) par `walletPubKey`
  - B) Pointeur on-chain
  - C) IPNS
- **Raison** : A minimise l’effort MVP et permet de valider le flux bout-en-bout (upload → append manifest → My files). B/C sont plus robustes (cross-device) mais hors MVP.
- **Impact** :
  - Technique : persistance uniquement “same device / same browser”.
  - UX : pas de récupération automatique cross-device.
  - Sécurité : on ne stocke qu’un CID (non secret), pas de clés.
- **Statut** : Accepted

---

## T06-D002 — Clé de chiffrement du manifest dérivée de la KEK via HKDF (séparation de contexte)

- **Décision** : `ManifestKey = HKDF(KEK, salt=null, info="SJ-MANIFEST-v1", length=32)`.
- **Contexte** : Éviter la réutilisation directe de la KEK, séparer strictement les contextes crypto.
- **Options considérées** :
  - A) Dériver une clé dédiée via HKDF info `"SJ-MANIFEST-v1"`
  - B) Utiliser directement la KEK
- **Raison** : A évite les collisions de contexte et respecte la séparation des clés.
- **Impact** :
  - Technique : nécessite HKDF-SHA256 déjà présent dans `@sj/crypto`.
  - Sécurité : réduction du risque de key reuse.
- **Statut** : Accepted

---

## T06-D003 — Alignement crypto strict avec Task 5 / Task 4 (pas de nouvelle stack)

- **Décision** : Le manifest réutilise strictement les mêmes primitives et conventions que le pipeline existant :
  - XChaCha20-Poly1305 via libsodium (`libsodium-wrappers`)
  - Canonicalization RFC8785 via `canonicalize` (pour AEAD/AAD)
  - SHA-256 via `@sj/crypto.sha256`
- **Contexte** : Risque élevé de divergence (AAD, encodages, base64, canonicalization) si une nouvelle stack est introduite.
- **Options considérées** :
  - A) Réutiliser les helpers/libs existants “à l’identique”
  - B) Introduire une nouvelle implémentation (nouvelle lib / nouvelles conventions)
- **Raison** : A garantit la cohérence interne du système et réduit le risque de bugs cryptos subtils.
- **Impact** :
  - Technique : dépendance sur le code existant (Task 4/5).
  - Sécurité : cohérence des conventions crypto, meilleure auditabilité.
- **Statut** : Accepted

---

## T06-D004 — Règle d’intégrité strictement identique à Task 5 (JSON.stringify hash basis)

- **Décision** : L’intégrité du manifest suit exactement la règle Task 5 :
  - Construire un `hashBasis` qui exclut le champ `integrity`
  - Calculer `sha256(TextEncoder().encode(JSON.stringify(hashBasis)))`
  - Encoder en base64 → `integrity.sha256B64`
- **Contexte** : Deux règles différentes de hash dans le projet (canonicalize vs stringify) créeraient une incohérence et des difficultés de maintenance.
- **Options considérées** :
  - A) `JSON.stringify(hashBasis)` (aligné Task 5)
  - B) `canonicalize(hashBasis)` (plus “pur” académiquement)
- **Raison** : La cohérence interne prime. La Task 6 doit rester compatible avec l’existant.
- **Impact** :
  - Technique : la stabilité du hash dépend de l’ordre d’insertion des clés (comportement standard `JSON.stringify`).
  - Sécurité : détection de corruption/tampering via SHA-256 + comparaison.
- **Statut** : Accepted

---

## T06-D005 — Concurrence MVP : mutex in-tab + read → merge → write (pas de multi-onglet)

- **Décision** : Gérer la concurrence via un mutex en mémoire (in-tab) + stratégie `read → merge → write`.
- **Contexte** : Plusieurs appels append peuvent arriver quasi simultanément (ex: double upload / UI). Le MVP ne gère pas les locks inter-onglet.
- **Options considérées** :
  - A) Mutex in-tab + read/merge/write
  - B) Lock inter-tab (BroadcastChannel / storage events / etc.)
  - C) Conflit multi-device/on-chain (hors MVP)
- **Raison** : A répond au besoin MVP en limitant la complexité. B/C sont hors scope MVP.
- **Impact** :
  - Technique : réduit le risque de perte d’entrées dans un même onglet.
  - Limite : deux onglets peuvent provoquer “last write wins”.
- **Statut** : Accepted

---

## T06-D006 — Politique d’erreur : blocage explicite, pas de régénération silencieuse, pas de modification du pointeur

- **Décision** : En cas d’erreur (IPFS KO, decrypt KO, integrity KO), on :
  - bloque l’opération (throw / message explicite)
  - **ne modifie pas** `manifestCid`
  - **n’upload pas** un nouveau manifest
  - **n’essaie jamais** de régénérer un manifest vide automatiquement
- **Contexte** : Une régénération silencieuse détruirait les références (perte logique) et pourrait rendre des fichiers irrécupérables.
- **Options considérées** :
  - A) Erreur explicite + zéro écriture
  - B) Auto-reset vers manifest vide
- **Raison** : A évite toute corruption/destruction silencieuse et respecte la souveraineté utilisateur.
- **Impact** :
  - UX : message d’erreur actionnable (“réessayer”).
  - Sécurité / fiabilité : pas de perte silencieuse de l’inventaire.
- **Statut** : Accepted

---

## T06-D007 — Separation of Verify and Unlock cryptographic roots (manifest KEK derivation)

- **Constat** : Le unwrap du manifest échoue si `Unlock Vault` ne signe pas `SJ_UNLOCK_V1` (la KEK dérivée est différente, donc le ciphertext du wrap ne peut pas être déchiffré).
- **Décision** :
+  - **Proof-of-control / Verify**
+    - Sert uniquement à prouver la possession du wallet (gating UX).
+    - Ne participe pas à la dérivation de KEK.
+    - Peut utiliser un message distinct (non `SJ_UNLOCK_V1`).
+  - **Unlock Vault**
+    - Doit obligatoirement signer `buildUnlockMessageV1().messageToSign` (`SJ_UNLOCK_V1`).
+    - Cette signature est la **seule** source valide pour dériver la KEK (`deriveKekFromUnlockSignature`).
+    - Non persistée : conservée uniquement en mémoire session.
+    - Le `BuildUnlockResult` (canonicalObject + messageToSign) est conservé en mémoire session.
+  - **Manifest**
+    - Ne reconstruit jamais un unlock arbitraire.
+    - Reçoit explicitement `unlock: BuildUnlockResult` + `signatureBytes` (issus de l’étape Unlock) pour unwrap le `ManifestKey`.
+    - Refuse explicitement toute dérivation KEK basée sur une signature persistée (ex: `loadIdentity`) si elle ne signe pas `SJ_UNLOCK_V1`.
+- **Implications** :
+  - L’état de session doit exposer `lastUnlock` et `lastUnlockSignatureBytes`.
+  - `loadIdentity()` ne doit pas être utilisé pour dériver la KEK du manifest.
+  - Toute tentative de dérivation avec une signature non conforme doit échouer explicitement (message actionnable).
+- **Raison** :
+  - Cohérence cryptographique (racine unique pour la KEK).
+  - Séparation UX (Verify) / crypto root (Unlock).
+  - Prépare la migration vers pointeur on-chain/IPNS.
+  - Respect de l’esprit OQ-11 : pas de persistance de matériaux cryptographiques sensibles.
+- **Statut** : Accepted
+
+---
+
## T06-D008 — Introduction d’un Vault Root stable (SJ_VAULT_ROOT_V1) pour persistance inter-refresh du manifest

1️⃣ **Constat**
- Après `Ctrl+F5`, `unwrapManifestKey` échoue car `SJ_UNLOCK_V1` inclut des champs volatils (issuedAt/expiresAt/nonce/origin) et la signature change entre sessions, donc la KEK dérivée change.
- OFF-04 (changement d’origin/host/port : `localhost` vs `127.0.0.1`) confirme que si `origin` est inclus dans VaultRoot, on crée des coffres différents pour un même wallet selon l’URL.
- Conclusion : `SJ_UNLOCK_V1` ne peut pas être la racine de dérivation KEK si on veut relire un manifest après refresh, et VaultRoot ne doit pas dépendre de l’URL.

2️⃣ **Décision**
- On introduit un message stable dédié : **`SJ_VAULT_ROOT_V1`**.
- **Vault Root (SJ_VAULT_ROOT_V1)**
  - Message stable **sans champs volatils** (pas de issuedAt/expiresAt/nonce).
  - **Exclut `origin`** pour éviter des coffres multiples selon l’environnement (host/port).
  - Dépend uniquement de :
    - `walletPubKey` (wallet)
    - `vaultId` (stable)
    - `version` (implicit via le template + canonical object)
  - Signature refaisable après refresh.
  - Matériel conservé uniquement en mémoire : `lastVaultRoot` + `lastVaultRootSignatureBytes` (non persisté).
  - Cette signature est la **seule** source valide pour dériver la KEK stable utilisée par le manifest.
- **Unlock Vault (SJ_UNLOCK_V1)**
  - Reste **inchangé** : volatile + TTL, sert au gating session (VaultUnlocked) et applique OQ-06.
  - Ne sert pas à la dérivation KEK du manifest.
- **Manifest**
  - `envelope.kekDerivation.messageTemplateId` doit refléter la réalité : `"SJ_VAULT_ROOT_V1"`.
  - Ne reconstruit jamais un challenge arbitraire.
  - Reçoit explicitement la signature Vault Root pour dériver la KEK stable.

3️⃣ **Migration / compat**
- Si un ancien manifest contient `envelope.kekDerivation.messageTemplateId = "SJ_UNLOCK_V1"` :
  - **erreur explicite**, pas de reset silencieux, pas de modification du pointeur local.

4️⃣ **Debug / traçage (sans fuite)**
- Sous `NEXT_PUBLIC_SJ_DEBUG=true`, on log **uniquement** `sha256B64(messageToSign)` :
  - pour `SJ_UNLOCK_V1`
  - pour `SJ_VAULT_ROOT_V1`
- Jamais de log du `messageToSign` brut ni des signatures.

5️⃣ **Raison**
- Cohérence cryptographique + persistance inter-refresh sans persistance de secrets.
- Éviter des coffres multiples dépendant de l’URL (origin/host/port).
- Maintien de la séparation Verify / Unlock / VaultRoot.
- Prépare la migration future vers pointeur on-chain/IPNS.

6️⃣ **Impact**
- UX : une signature additionnelle au moment de l’Unlock (Vault Root).
- Sécurité : pas de secrets persistés ; meilleure robustesse “wallet can open” après refresh.
- **Statut** : Accepted