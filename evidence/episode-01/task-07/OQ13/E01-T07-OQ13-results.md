# E01-T07-OQ13 — Secrets Not Persisted Qualification Report

**Date:** 2026-04-13T14:46:23.044Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `Unit/Integration with LocalStorage Mocks`

## 1. Objectif
Vérifier qu'après déverrouillage du vault puis perte de session applicative (refresh), les secrets nécessaires au déchiffrement ne restent pas persistés dans les stockages navigateur interdits.

## 2. Portée
- `SessionManager` (apps/web/src/lib/session/SessionManager.ts)
- Gestion du stockage local (`localStorage`)

## 3. Préconditions
- Simulation du `localStorage` via mock dans l'environnement de test.
- Wallet de test déterministe (Ed25519) via seed fixe pour répétabilité (§9).

## 4. Données de test
- **Wallet PubKey :** `AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9` (Déterministe)
- **Clé de stockage attendue :** `sj_verified_v1`

## 5. Procédure
1. Connecter le wallet (seed fixe) et déverrouiller le vault.
2. Vérifier que l'état `isVaultUnlocked()` est `true` et que les secrets de session sont présents en mémoire.
3. Inspecter le `localStorage` via une whitelist stricte des champs attendus dans `sj_verified_v1`.
4. Vérifier qu'aucun champ non-autorisé (ex: signature, kek, secret) n'est présent.
5. Simuler un refresh (nouvelle instance `SessionManager`).
6. **Step 6 Protocol :** Tenter l'accès aux secrets via `getLastUnlockSignatureBytes()`.
7. Vérifier que l'accès retourne `null` et que le vault est verrouillé.

## 6. Résultat attendu
- Avant refresh : Vault déverrouillé, secrets accessibles en mémoire.
- Après refresh : Vault verrouillé, secrets INACCESSIBLES (null).
- Aucun secret sensible trouvé dans `localStorage` (vérifié par whitelist).

## 7. Résultats observés

### 7.1 État avant Refresh

- **Vault Unlocked :** `true` ✅
- **Secrets en mémoire (Signatures) :** ✅ Présents
- **Clés dans localStorage :** `sj_verified_v1`
- **Audit `sj_verified_v1` :** Whitelist respectée, aucun secret détecté ✅

### 7.2 État après Refresh (Preuve d'inaccessibilité)

- **Vault Unlocked :** `false` ✅ (L'accès est perdu)
- **`getLastUnlockSignatureBytes()` :** `null` ✅ (Step 6 : Preuve que les secrets sont perdus)
- **Clés persistantes :** `sj_verified_v1`

## FINAL VERDICT: **PASS**
