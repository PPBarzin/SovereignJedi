# E01-T07-OQ14 — Note de Qualification

**Date de revue :** 2026-04-13  
**Réviseur :** Claude Code (Reviewer Agent)  
**Script révisé :** `packages/solana-registry/tests/E01-T07-OQ14-unauthorized-modification.test.ts`  
**Artefacts analysés :**
- `evidence/episode-01/task-07/OQ14/E01-T07-OQ14-results.json`
- `evidence/episode-01/task-07/OQ14/E01-T07-OQ14-results.md`

---

## 1. Conformité procédurale

| Critère | Statut | Détail |
|---|---|---|
| Convention de nommage (§5) | ✅ PASS | Script, dossier et artefacts au format `E01-T07-OQ14-*` |
| Wallets éphémères (§7.2) | ✅ PASS | Seeds fixes déterministes : `fill(0xAA)` (owner), `fill(0xBB)` (intruder) — aucun wallet personnel |
| Airdrop localnet (§7.3) | ✅ N/A | Airdrop requis par le protocole pour financer les transactions on-chain |
| Répétabilité (§9) | ✅ PASS | Seeds fixes → wallets, PDA, vaultId identiques à chaque run |
| Structure rapport §3 | ✅ PASS | Toutes sections présentes : Objectif, Portée, Préconditions, Données de test, Procédure, Résultats attendus, Résultats observés |
| Artefacts commitHash/environment (§8) | ✅ PASS | `16bc1e06336f6a191a00f15c1c66265e74d38ece` / `localnet (127.0.0.1:8899)` |

---

## 2. Solidité technique de la preuve

| Assertion | Statut | Preuve |
|---|---|---|
| Registry initialisé à 1 entrée avant attaque | ✅ PROUVÉ | `registryBefore.entries.length === 1`, `lastCid = bafybeigdyrzt5sfp7udm...` |
| Tentative intruder rejetée on-chain | ✅ PROUVÉ | `AnchorError: ConstraintSeeds (0x7d6)` — rejet au niveau programme, non client |
| PDA mismatch prouvé par les logs programme | ✅ PROUVÉ | `Left: 7g3fLAeA...` (ownerPDA fourni) ≠ `Right: BZotxuZe...` (PDA dérivé de intruder) |
| Détection d'erreur non-ambiguë | ✅ PROUVÉ | `errStr.includes('ConstraintSeeds') \|\| errStr.includes('0x7d6')` — conditions spécifiques |
| Registry inchangé après attaque (dump strict) | ✅ PROUVÉ | `entriesCount`, `lastCid`, `updatedAt` identiques avant/après — `registryUnchanged = true` |
| `updatedAt` immutable | ✅ PROUVÉ | `"1776092830"` identique — aucune écriture n'a modifié le compte on-chain |
| Verdict dérivé de valeurs observées | ✅ PROUVÉ | `verdict = (isConstraintError && registryUnchanged) ? 'PASS' : 'FAIL'` — les deux conditions requises, toutes deux issues de l'exécution réelle |

---

## 3. Statut des violations de la revue initiale

| Violation | Statut |
|---|---|
| V1 — Wallets non-déterministes (§9) | ✅ Corrigée — seeds fixes `fill(0xAA)` et `fill(0xBB)` via `nacl.sign.keyPair.fromSeed()` |
| V2 — Dumps registry absents des artefacts | ✅ Corrigée — `registryDumps.beforeAttack` et `afterAttack` archivés avec trois champs comparés |
| V3 — Détection d'erreur trop large sur '2006' | ✅ Corrigée — condition restreinte à `'ConstraintSeeds' \|\| '0x7d6'` |

---

## 4. Violations

Aucune.

---

## 5. Verdict du réviseur

**APPROVED**

La preuve est complète et solide. Le rejet on-chain est prouvé par les logs du programme Anchor (ConstraintSeeds 0x7d6, PDA Left ≠ Right), confirmant que le contrôle d'accès est appliqué par le programme lui-même et non côté client. Les dumps de registre avant/après sur trois champs (entriesCount, lastCid, updatedAt) prouvent l'absence totale de modification. Les seeds déterministes garantissent la répétabilité §9.

> La qualification finale reste une décision humaine fondée sur l'analyse de ces preuves (§10).
