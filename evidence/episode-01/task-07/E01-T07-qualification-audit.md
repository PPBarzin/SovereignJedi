# E01-T07 — Task 07 Qualification Audit Report

**Date:** 2026-04-14
**Reviewer:** Reviewer Agent
**Scope:** Audit de la qualification complète Task 07 (Solana Registry)

---

## 1. Executive Verdict

| Critère | Valeur |
| :--- | :--- |
| Qualification credibility | **MODERATE** |
| Can a human trust this summary? | **NO** |

**Justification :** L'absence de document de synthèse centralisé constitue en elle-même un défaut structurel. Les preuves existent mais sont fragmentées, incohérentes en format et comportent plusieurs points non prouvés ou insuffisamment caractérisés. Le verdict global "PASS" n'est pas soutenable en l'état.

---

## 2. Coverage Validation

### OQs présents dans l'evidence

| Dossier | OQs couverts |
| :--- | :--- |
| `init_task-07/` | OQ05 (multi-entry restore), OQ09 (invalid vaultId) |
| `task-07/` | OQ06, OQ10, OQ11, OQ12, OQ13, OQ14, OQ15, OQ16 |

### OQs absents — BLOQUANT

- **OQ07** — ABSENT. Aucun artefact trouvé.
- **OQ08** — ABSENT. Aucun artefact trouvé.

Ces deux numéros sont silencieusement sautés dans la numérotation sans explication. Aucune note de dérogation, aucun "N/A documenté", aucun périmètre exclu explicite.

### Incohérence de format d'archivage

| OQs | Format |
| :--- | :--- |
| OQ10–OQ14 | `results.json` + `results.md` + `qualification-note.md` |
| OQ06 | `results.json` + `results.md` (pas de note de revue) |
| OQ15–OQ16 | `results.json` + `results.md` + `review.md` (format différent) |

Le format d'archivage n'est pas uniforme sur la totalité des OQs.

---

## 3. Evidence Validation

| OQ | Solidité | Remarque |
| :--- | :--- | :--- |
| OQ06 — Duplicate Entry | **FAIBLE** | Résultat archivé mais aucune note de qualification formelle. Seul OQ sans revue documentée. |
| OQ10 — VaultId Hash Consistency | **SOLIDE** | Logs on-chain présents, contrôle positif et négatif, note de qualification révisée. |
| OQ11 — RPC Down | **SOLIDE** | Deux chemins (write/read) prouvés via erreur réseau genuïne. Aucune donnée ni signature produite. |
| OQ12 — IPFS Timeout + Retry | **MODÉRÉ** | Logique `withRetry` correcte prouvée. Mais test 100% stub — aucun appel IPFS réel. |
| OQ13 — Secrets Not Persisted | **MODÉRÉ** | La note de qualification elle-même reconnaît que `getLastUnlockSignatureBytes()` retournant `null` est "trivial sur tout nouvel objet". |
| OQ14 — Unauthorized Wallet Modification | **SOLIDE** | Logs Anchor, PDA mismatch prouvé, dumps avant/après comparés sur 3 champs. |
| OQ15 — Publish Latency | **SOLIDE** | Stats vérifiées, 10 runs on-chain réels, médiane cohérente avec le slot Solana. |
| OQ16 — Restore Latency | **FAIBLE** | Voir §4. |

---

## 4. Detection of False Confidence

### PROBLÈME 1 — OQ16 : mesure non représentative présentée comme preuve de performance réelle

**Affirmation :** "médiane de 2.37 ms pour une restauration complète (Solana + IPFS)"

**Réalité :**
- 10 runs totalisant 26 ms (timestamps `.356Z` → `.382Z`).
- Cela implique zéro overhead inter-runs et une infrastructure 100% locale en mémoire.
- Une requête RPC réelle sur loopback génère un overhead TCP minimum de plusieurs millisecondes. Des mesures sous 2 ms sur Solana RPC ne sont pas des mesures d'intégration réseau — ce sont des mesures de cache ou de mock en mémoire.
- Aucun log RPC ne confirme que les appels ont réellement traversé le stack réseau.

**Conséquence :** le seuil cible de 3000 ms est trivial à atteindre dans ces conditions. Cette qualification ne dit rien sur les performances réelles.

### PROBLÈME 2 — OQ16 : découplage complet avec OQ15

OQ15 mesure la publication (write on-chain). OQ16 mesure la restauration (read on-chain + fetch IPFS local). Ces deux tests utilisent des données et environnements totalement indépendants. Aucune preuve que le flux complet `publish → store → restore → reconstruct` a été exécuté de bout en bout sur les mêmes données.

### PROBLÈME 3 — OQ12 : extrapolation silencieuse

Le summary présente "IPFS Timeout + Retry" comme qualifié. La preuve ne couvre que `withRetry` en isolation. L'intégration réelle entre le service layer et Helia sous timeout n'est pas testée. La couche de retry peut fonctionner seule tout en étant mal câblée dans le service.

### PROBLÈME 4 — Absence de document de synthèse

Un résumé de qualification est une affirmation sur un état global. Aucun document ne fait ce bilan formellement. Un humain ne peut pas lire "Task 07 : QUALIFIED" quelque part avec la liste des OQs couverts, les verdicts, et les réserves résiduelles.

---

## 5. Risk Audit

| Réf | Risque |
| :--- | :--- |
| R1 | OQ07 et OQ08 absents sans justification — périmètre non couvert inconnu. |
| R2 | OQ12 stub-only — la stratégie de retry peut être correcte et simultanément mal intégrée dans le vrai flux IPFS. |
| R3 | OQ16 vitesse anormale — la qualification de restore latency ne résiste pas à un déploiement devnet où le RPC est réseau réel. La mesure sera 100× plus lente et aucun seuil devnet n'est établi. |
| R4 | OQ06 sans revue formelle — si la logique de détection de doublon comporte une subtilité, elle n'a pas été challengée par le reviewer. |
| R5 | Flux E2E non couvert — publish (OQ15) et restore (OQ16) sont deux tests indépendants. Aucun test ne prouve que l'artefact publié peut être restauré. |

---

## 6. Contradictions

### C1 — CID intrus invalide dans OQ14

Le CID utilisé pour la tentative d'intrusion est `bafybeig-intruder-entry-that-should-fail-v1`. Ce CID contient des tirets, ce qui le rend invalide selon la validation stricte CIDv1 (Base32 RFC4648 : pas de tirets). Le rejet observé (`ConstraintSeeds`) est correct, mais il survient avant même la validation CID — la validation CID n'est donc pas exercée dans ce test.

### C2 — OQ16 : temps incompatibles avec un RPC réel

OQ16 prétend mesurer "Solana + IPFS" mais les temps (2–4 ms) sont incompatibles avec un appel RPC ayant réellement traversé le stack réseau, même sur loopback.

---

## 7. Critical Gaps

| Réf | Gap |
| :--- | :--- |
| G1 | Aucun document de synthèse Task 07 — **REQUIS** avant de clôturer la qualification. |
| G2 | OQ07 et OQ08 : justification d'absence ou couverture manquante non documentée. |
| G3 | Flux E2E publish → restore sur les mêmes données : non couvert. |
| G4 | OQ16 avec RPC réel (pas en mémoire) : non couvert. La mesure actuelle n'est pas représentative. |
| G5 | OQ06 : revue formelle manquante. |
| G6 | OQ12 : test d'intégration `withRetry` + Helia réel sous timeout : non couvert. |

---

## 8. Reviewer Verdict

### NOT PROVEN

Les OQs individuels présentent une solidité variable (certains excellents, d'autres faibles). Mais l'ensemble ne constitue pas une qualification Task 07 recevable.

**Motifs :**
1. Aucun document de synthèse formalisé.
2. OQ07 et OQ08 absents sans dérogation.
3. OQ16 vitesse anormale — mesure non représentative.
4. OQ12 stub-only — intégration réelle non prouvée.
5. Flux E2E non couvert.

### Actions bloquantes avant re-soumission

| Réf | Action |
| :--- | :--- |
| A1 | Produire `E01-T07-qualification-summary.md` avec tableau complet des OQs, verdicts et réserves. |
| A2 | Documenter le sort de OQ07 et OQ08 (N/A motivé ou exécution requise). |
| A3 | Requalifier OQ16 avec preuve que le RPC a réellement été sollicité (logs de connexion ou compteur d'appels). |
| A4 | Ajouter une note de revue formelle pour OQ06. |
