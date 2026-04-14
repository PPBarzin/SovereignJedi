# E01-T07-OQ06 — Duplicate Entry Rejection Qualification Report

**Date:** 2026-04-13T12:55:42.429Z
**Wallet:** `2TAMPDVBG434VxfuQHeHJBosXvSgmPkBZvTCGzFA5M8E`
**Vault ID:** `oq06-vault-hj5bt5`
**Registry Address:** `7pvQQczjwNtwAFnUJ9JyCEZj2Zy1nSv5P7mLq4D19t4t`

## 1. Objectif
Vérifier que le registre rejette les `manifestCid` dupliqués et préserve l'état.

## 2. Successful First Append

- CID: `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki`
- Transaction: [`4TrK69arSizLuV1i...`](https://explorer.solana.com/tx/4TrK69arSizLuV1iQCmuJXVGcRNF5HU9RZFvhsgAiZCq2sxghA6ahWACvydq5bqKEQJNELnauYxgJUE3MtsSMEeX?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899)
- Status: ✅ Confirmé

## 3. Duplicate Attempt Rejection

- Tentative de publication du même CID une seconde fois.
- **Résultat:** ❌ Rejeté par le programme
- **Erreur attendue:** `DuplicateEntry` (0x1772 / 6002)
- **Message d'erreur réel:** `Error: Simulation failed. `
<details><summary>Logs du programme</summary>

```
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd invoke [1]
Program log: Instruction: AppendManifest
Program log: AnchorError thrown in src/lib.rs:59. Error Code: DuplicateEntry. Error Number: 6002. Error Message: Manifest CID already published..
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd consumed 11136 of 200000 compute units
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd failed: custom program error: 0x1772
```

</details>

## 4. On-Chain State Integrity

| Métrique | Avant Tentative | Après Échec | Match |
|--------|----------------|---------------|-------|
| Entries Count | 1 | 1 | ✅ |
| Head CID | `bafybeigdyrz...` | `bafybeigdyrz...` | ✅ |
| Last Updated | `1776084941` | `1776084941` | ✅ |

- **Vérification d'intégrité:** L'état du registre est resté strictement inchangé après la transaction rejetée : **✅ PASS**

### FINAL VERDICT: **PASS**
