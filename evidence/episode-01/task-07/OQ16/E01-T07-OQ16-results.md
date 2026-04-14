# E01-T07-OQ16 — Restore Latency Qualification Report

**Date:** 2026-04-14T08:14:57.384Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `localnet (Solana) + local IPFS`
**Wallet:** `823Msawk8dWX1cURDovT6ctcGZ1mxrnHSH2DuiAuca9y`
**Target Threshold:** `< 3000ms`

## 1. Objectif
Mesurer le temps total de restauration (`fetchRegistry` + `catBytes`) sur environnement localnet/local-ipfs et vérifier la réactivité.

## 2. Portée
Couvre le `RegistryService` (apps/web/src/lib/solana/RegistryService.ts) incluant la récupération RPC Solana et le fetch IPFS.

## 3. Préconditions
- Local Solana validator actif.
- Local IPFS (Helia) actif.
- Registre pré-peuplé avec un manifest de 1KB.

## 4. Données de test
- **Nombre de runs :** `10`
- **Taille du manifest :** `1024 bytes`
- **CID :** `bafkreie6dstxcjucyfa6dfurpruqb5xhyf6lnp6lbzhwj4iynqzokcvopi`

## 5. Statistiques Agrégées (Total)

| Métrique | Valeur (ms) |
| :--- | :--- |
| Minimum | `2.04` |
| Maximum | `3.98` |
| Moyenne | `2.66` |
| Médiane | `2.37` |
| **Seuil Cible** | **`< 3000`** |

## 6. Détails des Runs

| Run # | Solana (ms) | IPFS (ms) | TOTAL (ms) |
| :--- | :--- | :--- | :--- |
| 1 | 2.4 | 1.19 | **3.63** |
| 2 | 1.69 | 0.65 | **2.35** |
| 3 | 1.44 | 0.93 | **2.38** |
| 4 | 2.78 | 1.19 | **3.98** |
| 5 | 2.56 | 0.83 | **3.39** |
| 6 | 1.47 | 0.68 | **2.15** |
| 7 | 1.4 | 0.65 | **2.05** |
| 8 | 1.64 | 0.81 | **2.45** |
| 9 | 1.55 | 0.62 | **2.17** |
| 10 | 1.45 | 0.59 | **2.04** |

## 7. Analyse et Verdict
Les mesures incluent le temps de réponse RPC et le temps de récupération IPFS local.
Le verdict final est basé sur la médiane des temps totaux.

## FINAL VERDICT: **PASS**
