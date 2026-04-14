# E01-T07-OQ13 — Note de Qualification

**Date de revue :** 2026-04-13  
**Réviseur :** Claude Code (Reviewer Agent)  
**Script révisé :** `apps/web/tests/E01-T07-OQ13-secrets-not-persisted.test.ts`  
**Artefacts analysés :**
- `evidence/episode-01/task-07/OQ13/E01-T07-OQ13-results.json`
- `evidence/episode-01/task-07/OQ13/E01-T07-OQ13-results.md`

---

## 1. Conformité procédurale

| Critère | Statut | Détail |
|---|---|---|
| Convention de nommage (§5) | ✅ PASS | Script, dossier et artefacts au format `E01-T07-OQ13-*` |
| Wallet éphémère (§7.2) | ✅ PASS | `nacl.sign.keyPair.fromSeed(fill(1))` — seed fixe, aucun wallet personnel |
| Absence d'airdrop (§7.3) | ✅ N/A | Aucune interaction on-chain |
| Répétabilité (§9) | ✅ PASS | Seed déterministe `Uint8Array(32).fill(1)` — pubKey identique à chaque run |
| Structure rapport §3 | ✅ PASS | Toutes sections présentes : Objectif, Portée, Préconditions, Données de test, Procédure, Résultats attendus, Résultats observés |
| Artefacts commitHash/environment (§8) | ✅ PASS | `16bc1e06336f6a191a00f15c1c66265e74d38ece` / `Unit/Integration with LocalStorage Mocks` |

---

## 2. Solidité technique de la preuve

| Assertion | Statut | Preuve |
|---|---|---|
| Vault déverrouillé avant refresh | ✅ PROUVÉ | `observed_vaultUnlockedBefore = sm.isVaultUnlocked()` → `true` |
| Secrets présents en mémoire avant refresh | ✅ PROUVÉ | `sigBefore = sm.getLastUnlockSignatureBytes()` → non-null |
| sj_verified_v1 ne contient que des champs autorisés | ✅ PROUVÉ | Whitelist stricte `['walletPubKey','verifiedAt','expiresAt','walletProvider','nonce','issuedAt']` — `forbiddenFields.length === 0` |
| sj_verified_v1 ne contient pas de valeur encodée suspecte | ✅ PROUVÉ | Aucune valeur string > 64 chars hormis `walletPubKey` |
| Vault verrouillé après refresh | ✅ PROUVÉ | `smNew.isVaultUnlocked()` → `false` |
| Secrets inaccessibles après refresh (Step 6) | ✅ PROUVÉ | `smNew.getLastUnlockSignatureBytes()` → `null` ET `smNew.getLastVaultRootSignatureBytes()` → `null`, alors que le même objet `storage` est conservé |
| Artefacts issus de l'exécution réelle | ✅ PROUVÉ | Variables partagées initialisées aux valeurs de sécurité (`observed_secretsInStorage = true`, `observed_reUnlockRequired = false`, `observed_verifiedSignalStatus = 'FAIL'`) — verdict PASS structurellement impossible sans exécution des assertions |

---

## 3. Statut des violations de la revue initiale

| Violation | Statut |
|---|---|
| V1 — Step 6 absent (preuve d'inaccessibilité) | ✅ Corrigée — `getLastUnlockSignatureBytes()` et `getLastVaultRootSignatureBytes()` assertés null sur le nouvel objet partageant le même localStorage |
| V2 — Scan par mots-clés fragile | ✅ Corrigée — whitelist stricte des champs autorisés + heuristique longueur > 64 chars pour valeurs encodées |
| V3 — Keypair non déterministe | ✅ Corrigée — seed fixe `Uint8Array(32).fill(1)` |
| V4 — Constantes codées en dur dans les artefacts | ✅ Corrigée — variables partagées initialisées FAIL, formule de verdict dérivée de l'exécution |

---

## 4. Note résiduelle (non-bloquante)

`getLastUnlockSignatureBytes()` retourne `this.lastUnlockSignatureBytes`, initialisé à `null` dans le constructeur — trivial sur tout nouvel objet. La valeur probante repose sur le maintien du même objet `storage` à travers le "refresh" : si l'implémentation avait désérialisé un secret depuis `localStorage`, il apparaîtrait non-null. L'assertion est donc fonctionnellement valide comme test de non-régression, même si techniquement non-surprenante sur un objet vierge.

---

## 5. Violations

Aucune.

---

## 6. Verdict du réviseur

**APPROVED**

Les quatre violations de la revue initiale sont corrigées. L'invariant central — les matériaux cryptographiques de session ne survivent pas à un refresh — est prouvé à deux niveaux : (1) `isVaultUnlocked() === false` et (2) `getLastUnlockSignatureBytes() === null` ET `getLastVaultRootSignatureBytes() === null` sur un objet instancié avec le même localStorage actif. Le contenu de `sj_verified_v1` est vérifié par whitelist stricte. Les artefacts reflètent l'exécution réelle. La répétabilité est garantie par seed fixe.

> La qualification finale reste une décision humaine fondée sur l'analyse de ces preuves (§10).
