# E01-T07-OQ10 — VaultId Hash Consistency Qualification Report

**Date:** 2026-04-13T13:16:23.045Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `localnet (127.0.0.1:8899)`
**Wallet:** `88gk7vNNY2aiLLBxAG2aE19SLugYvJeNq57Mt7nrFA9D`
**Vault ID:** `oq10-integrity-test-vector-v1`

## 1. Objectif
Vérifier que le programme rejette strictement une instruction `init_registry` où le `vaultIdHash` fourni ne correspond pas au hash SHA-256 du `vaultId` en clair.

## 2. Portée
Instruction `init_registry` du programme `sj_registry_program`.

## 3. Préconditions
- Local validator actif sur le port 8899
- Programme déployé à l'adresse `89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd`
- Wallet de test financé via airdrop

## 4. Données de test
- **VaultID Déterministe :** `oq10-integrity-test-vector-v1`
- **Valid Hash :** `b61fdc341497c7f2ba70c3ef2205965187a354c822cd2569b4256ad8a1659669`
- **Forged Hash (Invalid) :** `41d095e8bc08cfa5b5a3b86ffe2c248f768bf910f3ac2a2a52c7b607e2ae72ba`

## 5. Procédure
1. Calculer le hash valide du VaultID.
2. Forger un hash invalide (hash d'une autre chaîne).
3. Appeler `init_registry` avec le VaultID clair et le hash FORGÉ.
4. Capturer l'erreur et vérifier le code `6003` (`InvalidVaultIdHash`).
5. Vérifier qu'aucun compte n'a été créé à l'adresse dérivée du hash invalide.
6. Effectuer un contrôle positif avec un hash valide pour confirmer le fonctionnement nominal.

## 6. Résultat attendu
L'instruction avec le hash forgé doit être rejetée avec l'erreur `InvalidVaultIdHash`. Aucun état on-chain ne doit être créé pour cette entrée.

## 7. Résultats observés

### 7.1 Test d'intégrité (Négatif)

- **Result:** ❌ Transaction rejetée par le programme
- **Error Code:** `6003` (InvalidVaultIdHash)
<details><summary>Program Logs</summary>

```
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd invoke [1]
Program log: Instruction: InitRegistry
Program 11111111111111111111111111111111 invoke [2]
Program 11111111111111111111111111111111 success
Program log: AnchorError thrown in src/lib.rs:25. Error Code: InvalidVaultIdHash. Error Number: 6003. Error Message: Vault ID hash mismatch..
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd consumed 9942 of 200000 compute units
Program 89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd failed: custom program error: 0x1773
```

</details>

### 7.2 Vérification d'état

- **Création de compte au PDA forgé :** 🚫 Aucun (Account is null)
- **Contrôle positif (hash valide) :** ✅ Succès

## FINAL VERDICT: **PASS**
