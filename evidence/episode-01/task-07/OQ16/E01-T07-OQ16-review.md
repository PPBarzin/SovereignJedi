# E01-T07-OQ16 — Restore Latency Review Report

**Date:** 2026-04-14
**Reviewer:** Reviewer Agent
**Test ID:** E01-T07-OQ16
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`

---

## REVIEW REPORT

### 1. Scope Compliance
- OK
- 10 runs, localnet + local IPFS, périmètre mesuré défini (`fetchRegistry` + `catBytes`), preuves archivées.
- Taille du manifest documentée (1024 bytes). CID archivé.

### 2. Invariant Compliance (Onboarding Pack)
- N/A — test de mesure uniquement.
- OK

### 3. Security Check
- N/A
- OK

### 4. Architecture Check
- Fichiers archivés au bon emplacement.
- OK

### 5. Test Coverage
- 10 runs > minimum 5 requis — conforme.
- Décomposition par composant (Solana / IPFS) présente.
- min / max / moyenne / médiane / seuil cible présents.
- OK

### 6. Violations (re-soumission)
- Violation 1 (wallet address incohérente dans résumé verbal : `69MAnzW63pGf6oN6Y7fK2B3v6U8fK9Yy5W7v6U8fK9Yy` → `823Msawk8dWX1cURDovT6ctcGZ1mxrnHSH2DuiAuca9y`) : **CORRIGÉE**
- Aucune violation résiduelle.

### 7. Verdict
**APPROVED**

Résumé verbal cohérent avec les preuves archivées. Aucune dette documentaire résiduelle.

---

## Statistiques vérifiées

| Métrique | Valeur attendue | Valeur JSON | Statut |
| :--- | :--- | :--- | :--- |
| Min | 2.04 ms | 2.04 ms | OK |
| Max | 3.98 ms | 3.98 ms | OK |
| Moyenne | 2.66 ms | 2.66 ms | OK |
| Médiane | 2.37 ms | 2.37 ms | OK |
| Seuil cible | < 3000 ms | 3000 ms | OK |
| Verdict | PASS | PASS | OK |
