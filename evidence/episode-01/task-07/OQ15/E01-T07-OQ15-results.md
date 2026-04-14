# E01-T07-OQ15 — Publish Latency Qualification Report

**Date:** 2026-04-14T07:46:33.841Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `localnet (127.0.0.1:8899)`
**Wallet:** `Ecs89dz8NsNoSxyUtp54G2HPbmvJr8qZnxnWUqiLT92r`
**Target Threshold:** `< 2000ms`

## 1. Objectif
Mesurer le temps de publication (`append_manifest`) sur environnement localnet et vérifier la cohérence des performances.

## 2. Portée
Instruction `append_manifest` du programme `sj_registry_program` via le SDK client.

## 3. Préconditions
- Local validator actif.
- Wallet de test déterministe (seed fixe).
- Registre initialisé avant le début des mesures.

## 4. Données de test
- **Nombre de runs :** `10`
- **Payload :** CID unique par run (String 64 chars).

## 5. Statistiques Agrégées

| Métrique | Valeur (ms) |
| :--- | :--- |
| Minimum | `404.19` |
| Maximum | `467.41` |
| Moyenne | `425.07` |
| Médiane | `421.2` |
| **Seuil Cible** | **`< 2000`** |

## 6. Détails des Runs

| Run # | Timestamp | Durée (ms) |
| :--- | :--- | :--- |
| 1 | 2026-04-14T07:46:29.589Z | `417.08` |
| 2 | 2026-04-14T07:46:30.006Z | `423.03` |
| 3 | 2026-04-14T07:46:30.429Z | `405.04` |
| 4 | 2026-04-14T07:46:30.834Z | `438.1` |
| 5 | 2026-04-14T07:46:31.272Z | `422.43` |
| 6 | 2026-04-14T07:46:31.695Z | `419.58` |
| 7 | 2026-04-14T07:46:32.115Z | `419.97` |
| 8 | 2026-04-14T07:46:32.535Z | `404.19` |
| 9 | 2026-04-14T07:46:32.939Z | `433.85` |
| 10 | 2026-04-14T07:46:33.373Z | `467.41` |

## 7. Analyse et Verdict
Les mesures montrent une performance conforme à l'enveloppe attendue pour localnet.
La dispersion (`max - min`) est de `63.22ms`.

## FINAL VERDICT: **PASS**
