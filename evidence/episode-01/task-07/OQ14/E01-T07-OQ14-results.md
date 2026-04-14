# E01-T07-OQ14 — Unauthorized Wallet Modification Qualification Report

**Date:** 2026-04-13T15:07:11.529Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `localnet (127.0.0.1:8899)`
**Owner Wallet:** `GZXyfzSTCBmA7rpeDLrmUbiSA45H5EEwJhoBeR6ZNb3u`
**Intruder Wallet:** `9SKMfAuZCbrG8kfjWviV8zYkuSXeuq2bMseV4J4TNgiu`
**Vault ID:** `oq14-access-control-v1`

## 1. Objectif
Vérifier qu'un wallet non propriétaire ne peut pas modifier le registry d'un autre wallet pour un `vaultId` donné.

## 2. Portée
Instruction `append_manifest` du programme `sj_registry_program`.

## 3. Préconditions
- Local validator actif.
- Registre existant créé par `W_owner` (seed fixe).
- `W_intruder` (seed fixe) financé et prêt à tenter une écriture.

## 4. Données de test
- **PDA cible (Owner) :** `7g3fLAeAQQjnvj6127HJHFukRJdB29JDUwi4DhQGtWvU`
- **CID légitime :** `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki`
- **CID intrus :** `bafybeig-intruder-entry-that-should-fail-v1`

## 5. Procédure
1. `W_owner` initialise son registre et ajoute une première entrée.
2. Capturer un dump complet de l'état du registre avant l'attaque.
3. `W_intruder` tente d'appeler `append_manifest` en passant le PDA de `W_owner` mais en signant avec sa propre clé.
4. Capturer l'erreur (attendue : `ConstraintSeeds` car le PDA ne correspond pas au dérivateur `W_intruder`).
5. Capturer un dump complet après l'attaque.
6. Comparer les deux dumps pour prouver l'absence totale de modification.

## 6. Résultat attendu
La tentative de `W_intruder` doit être rejetée on-chain. Le registre de `W_owner` doit rester strictement inchangé (dump avant == dump après).

## 7. Résultats observés

### 7.1 Comparaison des Dumps de Registre

| Propriété | État AVANT Attaque | État APRÈS Attaque |
| :--- | :--- | :--- |
| Entries Count | `1` | `1` |
| Last CID | `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki` | `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki` |
| Updated At | `1776092830` | `1776092830` |

**Verdict de comparaison :** ✅ Inchangé

### 7.2 Tentative d'intrusion (Négatif)

- **Result:** ❌ Transaction rejetée par Anchor (ConstraintSeeds)
- **Error Code:** `0x7d6` (ConstraintSeeds)
<details><summary>Program Logs</summary>

```
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd invoke [1]
Program log: Instruction: AppendManifest
Program log: AnchorError caused by account: registry. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.
Program log: Left:
Program log: 7g3fLAeAQQjnvj6127HJHFukRJdB29JDUwi4DhQGtWvU
Program log: Right:
Program log: BZotxuZeCcLios3vitULCXnDWGHY5Aj6qvG3uYYSdckh
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd consumed 5457 of 200000 compute units
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd failed: custom program error: 0x7d6
```

</details>

## FINAL VERDICT: **PASS**
