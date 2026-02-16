# Sovereign Jedi — Monorepo (Episode I: The awakening)

Ce dépôt contient le monorepo du projet “Sovereign Jedi — Episode I (MVP)”.  
Objectif: livrer une expérience “data souveraine” côté utilisateur, avec une UI produit claire, et une architecture prête pour l’itération.

---

## Vision générale

- Données chiffrées côté client, souveraines et réutilisables.
- UX “Drive-like” simple: déposer un fichier, le retrouver, afficher ses propriétés.
- Progressive disclosure: pas d’infos techniques en vue principale; détails accessibles dans un panneau de propriétés.
- Itérations successives (Episodes/Tasks) pilotées par une spec UI/URS et un Decision log (ProgDec).

---

## Architecture (monorepo)

- apps/web — application Next.js (UI)
- packages/crypto — `@sj/crypto` (helpers crypto)
- packages/storage — `@sj/storage` (abstraction IndexedDB chiffrée)
- infra/ipfs — docker-compose pour un nœud IPFS local (optionnel pour le mock)
- docs/tasks — documentation par task (ex: task-02.md)

Outils:
- Node.js ≥ 18
- pnpm 8.x (corepack possible)
- Docker (optionnel) pour IPFS

---

## One-command dev

Deux modes via le script à la racine:

- Démarrage simple (UI seule):
  - `./dev.sh`
  - Health check automatique → affichera:
    - ✅ Dev server is up and healthy at: http://localhost:1620
    - ⚠️ IPFS unavailable — running in mock mode (si IPFS n’est pas up)

- Démarrage avec IPFS (optionnel):
  - `./dev.sh --with-ipfs`
  - Lance `infra/ipfs/docker-compose.yml`, attend l’API IPFS, puis l’UI.

Ports:
- UI (Next.js dev): 1620
- IPFS HTTP API: 5001 (http://127.0.0.1:5001/api/v0)

Prérequis (résumé):
- Node 18+, pnpm 8.9.0, curl/wget, (Docker pour --with-ipfs)
- Détails complémentaires dans ENVIRONMENT.md

---

## Setup “classique” (si vous n’utilisez pas dev.sh)

1) Installer deps:
- `pnpm install`

2) Lancer dev web:
- `pnpm --filter @sj/web dev` (port 1620 si configuré)

3) Tests & build (si utiles au scope courant):
- `pnpm -r test`
- `pnpm -r build`

---

## UI — état actuel (Task 2 + 2.5 appliquées)

- Header: statut wallet (mock) + toggle thème (☀️/🌙, persisté)
- Left panel (filters): All files, Shared with me, Private, Project X, Invoices
- Main panel:
  - Drop zone dédiée bleutée (drag & drop + bouton Select Files)
  - États visuels: drag-over / loading / success / error
  - Liste de fichiers (mock): Name, Size, Status, Date, Actions
  - Footer de liste “1–N of N”
- Panneau Propriétés (overlay):
  - Détails techniques visibles ici seulement (CID mock, “shared with”, permissions mock)
  - Fermeture via clic extérieur / bouton / ESC
- Hydratation Next.js stabilisée:
  - Rendu UI post-mount + suppressHydrationWarning sur les dates

Scope mock:
- Pas d’IPFS/chiffrement/wallet réels (hors périmètre Task 2/2.5)

---

## Documentation

Structure expected:
- README.md (ce document): vision générale, setup, architecture
- docs/tasks/task-XX.md: documentation spécifique par task

Smoke / libsodium quick notes:
- smoke: activer `NEXT_PUBLIC_ENABLE_SMOKE=1` → ouvrir `/dev/crypto-smoke` pour lancer le test runtime (1KB encrypt/decrypt).
- sync: synchroniser le bundle libsodium local via `pnpm run libsodium:sync` (copie déterministe du bundle `libsodium-wrappers-sumo@0.7.16`).
- browser: pré‑charger libsodium dans `globalThis.sodium` (ou bundle `libsodium-wrappers-sumo`) avant d’appeler l’API `@sj/crypto`.

Each document de task must contain:
- Objectif de la task
- Ce qui a été implémenté
- Comment tester
- Limites / out of scope
- Lien vers le ProgDec associé

Existant:
- docs/tasks/task-02.md — UI Skeleton (MVP)

Le README général doit être mis à jour si une task impacte la compréhension globale du projet (ex: ports, run, scope UI).

---

## Decision log — ProgDec (obligatoire)

- Un seul objet Anytype ProgDec par task
- Créé au début de la task
- Sert à tracer les décisions significatives

On consigne une décision si elle:
- touche à l’architecture
- touche à la sécurité
- impacte l’UX
- introduit une dépendance
- serait coûteuse à modifier plus tard

Format d’une décision:
- ID: TXX-D00N
- Décision: (1 phrase)
- Contexte: contrainte ou problème
- Options considérées: A / B (bref)
- Raison: pourquoi l’option retenue
- Impact: conséquences (techniques / UX / sécurité)
- Statut: Proposed / Accepted / Reverted

Les IDs peuvent être référencées dans:
- les commits Git
- la doc de task

---

## CI & qualité (à étendre au besoin)

- Tests unitaires (packages) via vitest
- Lint & typecheck (eslint/typescript)
- Pipeline: install → test → build

---

## Références rapides

- ENVIRONMENT.md — versions/ports/prérequis
- dev.sh — exécution en “one-command” (UI seule ou `--with-ipfs`)
- apps/web — UI Next.js
- packages/crypto — helpers crypto
- packages/storage — abstraction IndexedDB chiffrée
- infra/ipfs — docker-compose IPFS (optionnel)

