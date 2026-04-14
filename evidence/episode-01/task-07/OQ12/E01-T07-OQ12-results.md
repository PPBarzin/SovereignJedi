# E01-T07-OQ12 — IPFS Timeout + Retry Qualification Report

**Date:** 2026-04-13T14:23:33.255Z
**Commit:** `16bc1e06336f6a191a00f15c1c66265e74d38ece`
**Environment:** `Unit/Integration with IPFS/Retry Stubs`

## 1. Objectif
Vérifier que lorsqu'un chargement IPFS échoue par timeout transitoire, le système applique la stratégie de retry prévue et ne conclut à l'échec qu'après épuisement explicite.

## 2. Portée
- Utilitaire `withRetry` (apps/web/src/lib/utils/RetryUtils.ts)
- Intégration dans le service layer pour les fetch IPFS.

## 3. Préconditions
- Simulateur de fetch IPFS (fonction asynchrone) permettant d'injecter des échecs programmés.
- Utilisation de délais de backoff réduits pour une exécution rapide des tests.

## 4. Données de test
- **Stratégie attendue :** 3 retries (soit 4 tentatives max).
- **Backoff de base :** 10ms.

## 5. Procédure
### Scénario A (Transitoire)
1. Configurer une fonction de fetch qui échoue 2 fois consécutives avec `IPFS_TIMEOUT`, puis réussit.
2. Appeler la fonction via `withRetry` en capturant les logs d'exécution via `onRetry`.
3. Vérifier que l'opération réussit et que le nombre d'appels est exactement de 3.

### Scénario B (Persistant)
1. Configurer une fonction de fetch qui échoue systématiquement.
2. Appeler la fonction via `withRetry` en capturant les logs d'exécution.
3. Vérifier que l'erreur finale est levée après exactement 4 tentatives.

## 6. Résultat attendu
- Scénario A : Succès final après 2 retries.
- Scénario B : Échec explicite après 3 retries (4 tentatives).
- Présence des logs détaillés prouvant le déclenchement des retries.

## 7. Résultats observés

### 7.1 Scénario A : Échec transitoire

- **Verdict :** ✅ PASS
- **Tentatives observées :** 3
#### Logs de tentatives (Scénario A)

| Tentative | Type | Détail / Erreur | Backoff Suivant |
| :--- | :--- | :--- | :--- |
| 1 | RETRY | IPFS_TIMEOUT (Simulated) | 10ms |
| 2 | RETRY | IPFS_TIMEOUT (Simulated) | 30ms |
| 3 | SUCCESS | Data retrieved | - |

### 7.2 Scénario B : Échec persistant

- **Verdict :** ✅ PASS
- **Tentatives observées :** 4
#### Logs de tentatives (Scénario B)

| Tentative | Type | Détail / Erreur | Backoff Suivant |
| :--- | :--- | :--- | :--- |
| 1 | RETRY | IPFS_TIMEOUT (Persistent) | 10ms |
| 2 | RETRY | IPFS_TIMEOUT (Persistent) | 30ms |
| 3 | RETRY | IPFS_TIMEOUT (Persistent) | 90ms |
| 4 | TERMINAL_FAILURE | IPFS_TIMEOUT (Persistent) | - |

## FINAL VERDICT: **PASS**
