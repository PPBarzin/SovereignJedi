# Task 03 — Wallet connection (Solana)

But: document de test manuel et checklist DoD pour la Task 3 — "Wallet connection (Solana)".

Ce document complète le cahier des charges présent dans l’espace et décrit les étapes pour tester manuellement l’implémentation, les variables d’environnement à vérifier, les commandes utiles et la checklist "Definition of Done".

---

## Rappel rapide (contexte)
Objectif : fournir une identité Web3 fonctionnelle basée sur un wallet Solana (MVP : Phantom).
Fonctions principales à tester :
- Connexion / déconnexion du wallet (Phantom).
- Affichage de l'adresse (tronquée + copy).
- Signature d’un message non-transactionnel (proof-of-control).
- Vérification locale de la signature.
- Gating de l’upload : upload autorisé uniquement si identity vérifiée et non expirée.
- Pas de hot-switch : tout changement d’adresse doit forcer un disconnect + reconnect.

---

## Prérequis locaux
1. Node.js >= 18, pnpm (le repo utilise pnpm).
2. Avoir l’extension Phantom installée dans le navigateur (Chrome/Chromium/Edge/Brave).
3. Phantom configuré pour le cluster de test (par défaut `devnet`).
4. Branch courante : `task-03-wallet-connection` (la branche a été poussée dans le repo).

---

## Variables d’environnement importantes
- `NEXT_PUBLIC_SOLANA_CLUSTER` — cluster Solana utilisé par l’app frontend. Valeur recommandée pour dev : `devnet`. (Si non fournie, `devnet` est la valeur par défaut.)
- `PROOF_TTL_SECONDS` — TTL par défaut (interne). Par défaut = 86400 (24h).
- `NEXT_PUBLIC_PROOF_TTL_SECONDS` — optionnel : exposer TTL au client si l’UI en a besoin.
- `NEXT_PUBLIC_APP_DOMAIN` — optionnel : override du `domain` injecté dans le message à signer. Par défaut l’app utilise `window.location.host`.

Ces variables peuvent être dans un `.env.local` ou injectées par votre workflow. Exemple minimal `.env.local` :
```
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_APP_DOMAIN=localhost:1620
NEXT_PUBLIC_PROOF_TTL_SECONDS=86400
```

---

## Commandes utiles
- Installer dépendances (si nécessaire) :
  - pnpm install
- Lancer l’app frontend (Next.js) :
  - pnpm --filter @sj/web dev
  - (par défaut l’app écoute sur `http://localhost:1620` comme défini dans le package.json)
- Lancer tests unitaires :
  - pnpm --filter @sj/web test
- (Si modification de dépendances) reconstruire / ajouter : utiliser pnpm au workspace racine.

---

## Emplacements clefs (implémentation)
- Composants wallet : `apps/web/src/components/wallet/`
  - `ConnectWallet.tsx` — connect / disconnect + affichage adresse + bouton Verify
  - `VerifyWallet.tsx` — construction du message, signature via wallet, vérification locale, persistance `sj_identity`
  - `IdentityStatus.tsx` — affichage état de l’identité + métadonnées
  - `types.ts`, `utils.ts` — utilitaires (message builder, nonce, signature verify, storage helpers)
- Intégration UI : `apps/web/pages/index.tsx` (le mock a été remplacé par les nouveaux composants)
- Local storage keys :
  - `sj_lastWalletProvider`
  - `sj_identity`

---

## Scénarios de test manuel (Flows A/B/C/D)
Préalable : démarrer l’app, ouvrir `http://localhost:1620` dans un navigateur avec Phantom installé et réglé sur `devnet`.

Flow A — Connect
1. Dans le header, cliquer sur `Connect Wallet`.
2. Phantom doit ouvrir sa popup/modal et proposer la connexion.
3. Vérifier que l’UI passe en état "Connecté" et affiche l’adresse tronquée.
4. Tester le bouton "Copy" : coller le contenu du presse-papier dans un éditeur — l’adresse complète doit être copiée.

Expected:
- AC-1 : adresse visible + statut “Connected”.

Flow B — Verify (proof-of-control)
1. Après connexion, cliquer sur `Verify (Sign)` ou `Sign to Verify`.
2. Phantom affiche la requête de signature (message lisible contenant domain, publicKey, nonce, issuedAt, chain, purpose).
3. Accepter la signature dans Phantom.
4. L’app doit vérifier localement la signature, persister `sj_identity` et afficher `Verified`, `verifiedAt` et `expiresAt`.

Vérifier:
- Le message signé est lisible et contient `purpose: proof_of_control`.
- Signature stockée en base58 dans `sj_identity`.
- AC-2 : statut `Verified` + `verifiedAt` et `expiresAt` visibles.

Flow C — Upload gating
1. Tenter un upload (drag & drop ou `Select Files`) quand `verified=false` : l’action doit être bloquée.
2. L’UI doit afficher un message/drawer/toast "Signature required" avec bouton "Verify now".
3. Effectuer la vérification (Flow B) puis retenter l’upload : l’upload doit être autorisé.

Vérifier:
- AC-3 : Upload non vérifié bloqué ; après verify, upload autorisé.

Flow D — Disconnect / Reconnect / No-hot-switch
1. Depuis Phantom, changer de compte (switch account) ou dans l’app cliquer `Disconnect`.
2. L’app doit :
   - Nettoyer `sj_identity`
   - Mettre l’état à `Disconnected`
   - Si changement d’adresse externe : afficher "Wallet changed — please reconnect" ou message équivalent
3. Reconnecter le même wallet ou un autre (doit passer par un nouveau connect + verify).

Vérifier:
- AC-5 : Changement wallet/account force disconnect + reconnect.
- AC-6 : Disconnect efface l’identité et bloque l’upload.

Edge / erreurs à tester
- Wallet non installé : cliquer `Connect` doit montrer CTA "Install Phantom" avec lien.
- Rejeter la connexion dans Phantom : l’app doit montrer une erreur claire "user rejected connect".
- Rejeter la signature : afficher "user rejected sign" et rester en `Connected_Unverified`.
- TTL expiry : configurer TTL faible (ex: `NEXT_PUBLIC_PROOF_TTL_SECONDS=10`) pour tester expiration automatique :
  - Après expiration, état doit repasser à `Connected_Unverified` et upload bloqué (AC-4).
- Signature invalide (simulation difficile localement) : l’app doit afficher "Signature invalid" et forcer reset verify flow.

---

## Vérifications côté stockage local
Après une verification réussie, inspecter `localStorage` :
- clé `sj_identity` : JSON avec champs
  - `publicKey`, `message`, `signature`, `issuedAt`, `verifiedAt`, `expiresAt`, `nonce`, `cluster`, `domain`
- clé `sj_lastWalletProvider` : `"phantom"`

S’assurer qu’aucune clé privée ou seed n’est jamais écrite en clair nulle part.

---

## Tests unitaires & tests recommandés
Les tests unitaires doivent couvrir au minimum :
- `buildProofMessage()` — format stable (exemple attendu).
- `verifyMessageSignature()` (ou util équivalent) — vérifier qu’une signature valide passe et qu’une mauvaise échoue.
- TTL calculation (`computeExpiresAt`) et détection d’expiration.
- Logic de gating upload (autoriser / refuser selon identité & expiry).
- Reset sur wallet change (clearIdentity).

Commande pour exécuter les tests unitaires (si présents) :
- pnpm --filter @sj/web test

---

## Checklist — Definition of Done (DoD)
Cochez chaque ligne quand satisfaite.

Fonctionnel
- [ ] T3-FR-001 — L’utilisateur peut connecter un wallet Solana (Phantom).
- [ ] T3-FR-002 — L’UI détecte Phantom et propose d’installer si absent.
- [ ] T3-FR-003 — L’adresse est affichée (tronquée) et peut être copiée.
- [ ] T3-FR-004 — L’utilisateur peut signer le message de preuve (non-transactionnel).
- [ ] T3-FR-005 — L’app vérifie la signature localement (OK).
- [ ] T3-FR-006 — Upload bloqué tant que `verified=false` ou TTL expiré.
- [ ] T3-FR-007 — Disconnect nettoie l’état identité et caches.
- [ ] T3-FR-008 — Changement d’adresse force disconnect + reconnect (pas de hot-switch).

Non-fonctionnel / sécurité
- [ ] T3-NFR-SEC-001 — Aucune clé/seed privée n’est persistée.
- [ ] T3-NFR-SEC-002 — Nonce + issuedAt + domain inclus dans le message signé (anti-replay minimal).
- [ ] T3-NFR-UX-001 — TTL friendly : l’utilisateur n’est pas harcelé ; re-verify seulement si TTL expiré.
- [ ] T3-NFR-OBS-001 — Les erreurs sont classées et affichées (wallet missing, user reject connect, user reject sign, signature invalid, wallet changed, cluster mismatch).

Tests & QA
- [ ] Tests unitaires ajoutés et passant (signature verify, TTL, gating, reset on change).
- [ ] Tests manuels (Flows A/B/C/D) effectués et validés.
- [ ] Documentation : `docs/tasks/task-03-wallet-connection.md` (ce fichier) + `apps/web/src/components/wallet/README.md` mis à jour.
- [ ] ProgDec (`T03-D001`) créé et lié à la task (trace décision).
- [ ] Branche `task-03-wallet-connection` poussée (pas de PR — la merge sera faite manuellement).

Livrables
- [ ] Composants et utils ajoutés sous `apps/web/src/components/wallet/`
- [ ] Intégration de ces composants dans la page d’accueil `apps/web/pages/index.tsx`
- [ ] Instructions de test manuel et DoD checklist (ce fichier)
- [ ] Aucune clé/secret n’est commitée

---

## Notes et recommandations finales
- Assurez-vous que Phantom est configuré sur le même cluster que l’app (devnet par défaut). Si Phantom est en `mainnet-beta` alors la vérification locale peut échouer pour des raisons de mismatch si l’app attend `devnet`.
- Toujours afficher au user un message explicite : "This signature is free and is NOT a transaction".
- Le message à signer doit rester stable et lisible pour faciliter audits et support.
- Si vous voulez que je rédige un guide pas-à-pas d’installation Phantom + debug local, dites-le et je le produirai.

--- 

Fin du document.