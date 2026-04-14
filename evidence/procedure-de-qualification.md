---
# yaml-language-server: $schema=schemas/page.schema.json
Object type:
    - Page
Status: 4- Done
Tag:
    - Qualification
    - Procédure
workstreams:
    - architecture-and-tech.md
Backlinks:
    - Episodes
Creation date: "2026-03-15T15:44:11Z"
Created by:
    - Pierre-Philippe Barzin
Links:
    - architecture-and-tech.md
id: bafyreidvjlautqzd36nt6vzq3hkrmrnmgwl7phh3e4oxzk4hk54ro5nioe
---
# Procédure de qualification   
# Procédure de Qualification des Tests Techniques   
## 1. Objectif   
Définir la méthodologie standard utilisée pour qualifier les fonctionnalités techniques du projet. Cette procédure vise à garantir :   
- la répétabilité des tests   
- la traçabilité des preuves   
- la séparation des rôles entre implémentation, revue technique et décision de qualification   
   
Cette procédure s'applique à toutes les qualifications techniques (logique métier, invariants on-chain, intégrité d'état, protocoles techniques).   
Les qualifications purement UI/UX peuvent être exécutées manuellement lorsque leur automatisation n'est pas pertinente.   
**Règle par défaut :** toute qualification technique non liée à l'interface utilisateur doit être automatisée via un script dédié, sauf justification explicite contraire.   
 --- 
# 2. Principe général   
Chaque qualification suit le flux suivant :   
1. Implémentation d'un script de test dédié.   
2. Exécution réelle du script.   
3. Génération d'artefacts de preuve.   
4. Revue technique indépendante du script et des résultats.   
5. Décision humaine finale sur le statut de qualification.   
   
Principe fondamental :   
> Les agents produisent les preuves techniques.   
> La qualification finale est une décision humaine basée sur ces preuves.___   

# 3. Structure standard d'un OQ   
Chaque OQ doit suivre une structure homogène afin de garantir la lisibilité et la traçabilité.   
Structure recommandée :   
1. **Objectif**   
2. **Portée**   
3. **Préconditions**   
4. **Données de test**   
5. **Procédure**   
6. **Résultat attendu**   
7. **Preuves à archiver**   
   
Cette structure doit être utilisée pour tous les OQ du projet.   
 --- 
# 4. Rôles et responsabilités   
## 4.1 Agent Coder   
Responsable de :   
- implémenter le script de test   
- exécuter réellement le test   
- générer les artefacts de preuve   
- documenter les résultats   
   
Le coder **ne décide pas du statut final de qualification**.   
 --- 
## 4.2 Agent Reviewer   
Responsable de :   
- auditer le script de test   
- vérifier que le test couvre réellement l'OQ   
- analyser les artefacts produits   
- identifier les risques de faux positifs   
   
Le reviewer **n'attribue pas le statut final de qualification**, mais évalue la solidité technique des preuves.   
 --- 
## 4.3 Revue humaine   
Le responsable du projet décide du statut final de qualification sur base :   
- du protocole OQ   
- du script exécuté   
- du rapport du reviewer   
- des artefacts générés   
   
Statuts possibles :   
- **PASS** : comportement confirmé   
- **FAIL** : comportement incorrect   
- **REWORK REQUIRED** : test ou méthode à corriger   
- **NOT PROVEN** : preuves insuffisantes   
 --- 
   
# 5. Convention de nommage   
Tous les scripts et artefacts doivent respecter une convention stricte afin d'assurer la traçabilité.   
Format général :   
```
E{Episode}-T{Task}-OQ{XX}-{description}


```
### Scripts   
```
E01-T07-OQ05-multi-entry-restore.test.ts
E01-T07-OQ06-duplicate-entry-rejection.test.ts


```
### Artefacts   
```
E01-T07-OQ05-results.json
E01-T07-OQ05-results.md


```
### Notes de qualification   
```
E01-T07-OQ05-qualification-note.md


```
Cette convention est **obligatoire**.   
 --- 
# 6. Structure des scripts de qualification   
Chaque script doit :   
1. Préparer l'environnement de test.   
2. Exécuter les étapes décrites dans l'OQ.   
3. Capturer les résultats observés.   
4. Vérifier les assertions critiques lorsque possible.   
5. Générer des artefacts exploitables.   
   
Les scripts doivent être **rejouables** et produire les mêmes observations dans des conditions identiques.   
 --- 
# 7. Environnement de test automatisé (Solana / systèmes distribués)   
Afin de garantir la répétabilité, les scripts de qualification ne doivent pas dépendre d'opérations manuelles dans le terminal.   
Les règles suivantes s'appliquent :   
### 7.1 Validator   
Le validator de test peut être lancé une fois pour l'ensemble de la session de qualification :   
```
solana-test-validator --reset


```
Les scripts doivent ensuite se connecter explicitement à ce validator (ex : `http://127.0.0.1:8899`).   
### 7.2 Wallets de test   
Les scripts ne doivent **jamais utiliser un wallet personnel ou Phantom**.   
Chaque test doit générer un wallet éphémère :   
- `Keypair.generate()`   
   
Ce wallet est utilisé uniquement pour la durée du test.   
### 7.3 Airdrop automatique   
Les scripts doivent effectuer eux‑mêmes les airdrops nécessaires.   
Exemple :   
```
const sig = await connection.requestAirdrop(
  payer.publicKey,
  10 * LAMPORTS_PER_SOL
)
await connection.confirmTransaction(sig)


```
Aucun `solana airdrop` manuel ne doit être nécessaire.   
### 7.4 Interdictions   
Un test automatisé ne doit jamais dépendre de :   
- commandes manuelles `solana airdrop`   
- `solana balance`   
- un wallet Phantom   
- un wallet CLI personnel   
- un état précédent du validator   
   
Les scripts doivent préparer leur propre environnement.   
### 7.5 Principe   
Un test automatisé doit pouvoir être exécuté via une simple commande :   
```
pnpm test


```
et produire les mêmes résultats sans préparation manuelle.   
 --- 
# 8. Artefacts de preuve   
Chaque script doit :   
1. Préparer l'environnement de test.   
2. Exécuter les étapes décrites dans l'OQ.   
3. Capturer les résultats observés.   
4. Vérifier les assertions critiques lorsque possible.   
5. Générer des artefacts exploitables.   
   
Les scripts doivent être **rejouables** et produire les mêmes observations dans des conditions identiques.   
 --- 
# 7. Artefacts de preuve   
Chaque exécution doit produire des preuves archivables.   
Formats recommandés :   
- JSON (données brutes)   
- Markdown (rapport lisible)   
   
Les artefacts doivent contenir au minimum :   
- identifiant du test   
- date et heure   
- commit ou version du code   
- environnement utilisé   
- données de test   
- résultats observés   
- logs techniques   
- références aux transactions ou opérations exécutées   
 --- 
   
# 8. Organisation des preuves   
Les preuves doivent être archivées dans une structure stable permettant :   
- audit   
- requalification   
- traçabilité historique   
   
Structure recommandée :   
```
evidence/
  episode-01/
    task-07/
      OQ-05/
      OQ-06/


```
 --- 
# 9. Répétabilité   
Un test de qualification doit pouvoir être rejoué ultérieurement avec les mêmes scripts afin de :   
- confirmer l'absence de régression   
- qualifier une nouvelle version   
   
La répétabilité constitue un pilier de cette méthodologie.   
 --- 
# 10. Principe fondamental   
Un script de test produit des **preuves techniques**.   
La qualification finale reste une **décision humaine fondée sur l'analyse de ces preuves**.   
 --- 
# 9. Répétabilité   
Un test de qualification doit pouvoir être rejoué ultérieurement avec les mêmes scripts afin de :   
- confirmer l'absence de régression   
- qualifier une nouvelle version   
   
La répétabilité constitue un pilier de cette méthodologie.   
 --- 
# 10. Principe fondamental   
Un script de test produit des **preuves techniques**.   
La qualification finale reste une **décision humaine fondée sur l'analyse de ces preuves**.   
   
# **Note méthodologique**   
La procédure standard de qualification (scripts normalisés, naming convention, revue structurée) a été formalisée pendant l’exécution de Task07-OQ05 épisode 1.   
Elle sera appliquée systématiquement à partir de **Task07-OQ06**.   
OQ-05 constitue donc une **exécution pré-procédure**   
   
