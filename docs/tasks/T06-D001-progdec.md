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