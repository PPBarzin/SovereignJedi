# E01-T07-OQ11 — RPC Down Qualification Report

**Date:** 2026-04-13T13:43:18.632Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `localnet (Down simulation)`
**Wallet:** `F9kwEkN8eU5Btv9J4qVu2UTYWv3TpVZmJYpz9tmnpXcY`
**Target RPC:** `http://127.0.0.1:1` (Délivrément invalide)

## 1. Objectif
Vérifier qu'en cas d'indisponibilité RPC, les opérations de publication et de lecture échouent proprement sans corrompre l'état local ni produire un faux succès.

## 2. Portée
- Instruction `init_registry` (Publication)
- Helper `fetchRegistry` (Lecture)

## 3. Préconditions
- Port `1` sur `localhost` fermé (standard pour simuler un service injoignable)
- Injection de l'URL `http://127.0.0.1:1` via `Connection` explicite

## 4. Données de test
- **VaultID :** `oq11-rpc-down-test-v1`
- **VaultID Hash :** `c7983bb87ee41160edcfc19856ca5da4d6635c33fdbe62010463c4f159ee5bf5`

## 5. Procédure
1. Configurer une `Connection` Solana sur un port fermé (`http://127.0.0.1:1`).
2. Tenter d'initialiser un registre via `program.methods.initRegistry`. Cette opération force un appel réseau (`getLatestBlockhash`) qui doit échouer.
3. Vérifier que l'appel lève une exception réseau (`fetch failed`) et ne retourne aucune signature.
4. Tenter une lecture de registre via `fetchRegistry` sur la même connexion.
5. Vérifier que l'appel lève une exception réseau et ne retourne aucune donnée.

## 6. Résultat attendu
Les deux opérations doivent échouer avec une erreur de type `fetch failed` ou `ECONNREFUSED`. Aucun succès ne doit être signalé. L'invariant d'intégrité face aux pannes d'infrastructure est ainsi qualifié.

## 7. Résultats observés

### 7.1 Échec de Publication (Instruction Write)

- **Signature retournée :** `null` (Attendu: null)
- **Erreur capturée :** `Error: failed to get recent blockhash: TypeError: fetch failed` ✅

### 7.2 Échec de Lecture (Instruction Read)

- **Données retournées :** `null` (Attendu: null)
- **Erreur capturée :** `TypeError: fetch failed` ✅

## FINAL VERDICT: **PASS**
