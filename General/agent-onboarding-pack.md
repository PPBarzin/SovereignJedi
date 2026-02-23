

# Agent onboarding Pack

# Sovereign Jedi — Agent Onboarding Pack

> Document obligatoire à lire intégralement avant toute tâche.   
> Ce document définit le monde, les règles non négociables et le cadre d’exécution dans lequel l’agent de codage opère.   
> Toute décision ou implémentation en contradiction avec ce document est considérée comme incorrecte.___   

## 1) World Model (le monde dans lequel tu travailles)

Sovereign Jedi est une application **Web3 de stockage de fichiers chiffrés**, orientée **souveraineté utilisateur**.   
Principes fondamentaux :   

- L’utilisateur est **propriétaire de son identité** (wallet).   
- L’app **ne possède jamais** les clés privées ni les secrets utilisateurs.   
- Le chiffrement et l’identité sont **côté client**.   
- L’UX masque la complexité technique sans la déplacer côté serveur.   

### Ce que Sovereign Jedi N’EST PAS

- ❌ Un Google Drive centralisé   
- ❌ Un SaaS avec login email / mot de passe   
- ❌ Une app avec backend d’authentification classique   
- ❌ Un système custodial
  ---

## 2) Invariants non négociables (axiomes)

Ces règles **ne peuvent pas être remises en question** par l’agent.   

### Identité

- Le **wallet = l’identité**.   
- Aucune identité alternative (email, username, OAuth).   
- La connexion wallet seule **n’est pas suffisante**.   

### Proof of control

- Une **signature de message** est requise pour prouver le contrôle du wallet.   
- Cette signature est **non transactionnelle** (0 fee).   
- L’état **Verified est obligatoire pour uploader**.   

### Sécurité

- Aucune clé privée, seed ou secret ne quitte le wallet.   
- Aucun secret sensible n’est stocké de manière persistante.   
- Pas de “simplification” de la crypto via un serveur.   

### Architecture

- Pas de backend d’authentification.   
- Pas de session serveur.   
- L’état d’identité est géré côté client.
  ---

## 3) Décisions de design figées

Ces décisions sont **actées** pour le MVP.   

- Blockchain : **Solana**   
- Identité : **Wallet Solana**   
- Signature : **message de proof-of-control**   
- Upload : **bloqué si non vérifié**   
- Validité de la preuve :   
  - TTL par défaut : **24h**   
  - TTL **paramétrable** (config)   
- Multi-wallet / multi-compte :   
  - ❌ Pas de switch à chaud   
  - ✅ Disconnect + reconnect obligatoire   
  
  --- 

## 4) Modèle mental fonctionnel (glossaire minimal)

Les termes suivants doivent être utilisés **tels quels**.   

- **Connected** : wallet connecté, identité connue, mais non prouvée   
- **Verified** : preuve de contrôle valide (signature + TTL)   
- **Identity** : publicKey + preuve associée   
- **Proof-of-control** : signature de message prouvant le contrôle du wallet   
- **Upload gating** : upload autorisé uniquement si `verified=true`   
- **TTL** : durée de validité de la preuve
  ---

## 5) Ce que l’agent NE DOIT PAS faire

Interdictions explicites :   

- ❌ Ajouter un login email / mot de passe   
- ❌ Introduire une auth backend ou une session serveur   
- ❌ Stocker des clés ou seeds   
- ❌ Signer une transaction pour l’authentification   
- ❌ Autoriser l’upload sans état Verified   
- ❌ Permettre le switch de wallet sans disconnect   
- ❌ Modifier ou ignorer le modèle mental défini ci-dessus
  ---

## 6) Working Agreement (cadre d’exécution obligatoire)

### 6.1 Git workflow

- **Créer une nouvelle branche au démarrage de chaque task**   
  - Convention recommandée : `task-XX-short-name`   
- Aucun commit direct sur `main`   
- **1 commit = 1 intention claire**   
- **Push sur GitHub après chaque commit**   
- Messages de commit explicites et impératifs
  ---

### 6.2 Documentation

La documentation fait partie du livrable.   
Structure attendue :   

- `README.md` → vision générale, setup, architecture   
- `docs/tasks/task-XX.md` → documentation spécifique à la task   

Chaque document de task doit contenir :   

- Objectif de la task   
- Ce qui a été implémenté   
- Comment tester   
- Limites / out of scope   
- Lien vers le ProgDec associé   

Le README général doit être mis à jour **si la task impacte la compréhension globale du projet**.
---

### 6.3 Decision log — ProgDec (obligatoire)

- Un seul objet Anytype **`ProgDec` par task**   
- Créé **au début de la task**   
- Sert à tracer les **décisions de programmation significatives**   

Une décision doit être consignée si elle :   

- touche à l’architecture   
- touche à la sécurité   
- impacte l’UX   
- introduit une dépendance   
- serait coûteuse à modifier plus tard   

### Format obligatoire d’une décision

- **ID** : `TXX-D00N`   
- **Décision** : ce qui est choisi (1 phrase)   
- **Contexte** : contrainte ou problème   
- **Options considérées** : A / B (bref)   
- **Raison** : pourquoi l’option retenue   
- **Impact** : conséquences techniques / UX / sécurité   
- **Statut** : Proposed / Accepted / Reverted   

Les IDs de décisions peuvent être référencés dans :   

- les commits Git   
- la doc de task
  ---

## 7) Règle d’or

> Moins d’hypothèses, plus de contraintes explicites.   

Si une information n’est pas présente dans ce document ou dans la task fournie :   

- ❌ ne pas l’inventer   
- ❌ ne pas extrapoler   
- ✅ poser la question ou consigner une décision dans le ProgDec
  ---

## 8) Definition of Ready (avant de commencer une task)

Avant d’écrire du code, l’agent doit être capable de répondre :   

1. Dans quel monde je travaille ?   
2. Quelles règles je ne peux pas enfreindre ?   
3. Quelle est la task exacte à réaliser ?   
4. Où vais-je tracer mes décisions ?   

Si une de ces réponses est floue, **la task n’est pas prête**.   
