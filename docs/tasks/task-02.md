# Task 2 — UI Skeleton (MVP)

Cette task livre une interface « produit » présentable, totalement mockée, permettant de démo l’expérience sans exposer la technique (IPFS, crypto, IndexedDB) dans la vue principale.

---

## Objectif de la task

- Offrir une UI claire et montrable sans explication orale.
- Mettre en avant le geste principal: ajouter un fichier (drag & drop ou clic).
- Afficher une liste de fichiers (mock) et un panneau de propriétés (overlay).
- Ne pas exposer la technique (IPFS/CID/chiffrement) dans la vue principale.

---

## Ce qui a été implémenté

- Header
  - Titre « Sovereign Jedi »
  - État wallet (mock) + bouton Connect/Disconnect (mock)
  - Toggle thème avec icône (☀️/🌙), persistance localStorage

- Left panel (Navigation/Filters)
  - Vues: All files, Shared with me, Private, Project X, Invoices

- Main panel (principal)
  - Drop zone dédiée (bleutée) en carte centrale
    - Drag & drop global sur la carte
    - Bouton « Select Files »
    - États visuels: drag-over / loading (barre de progression) / success / error
  - File list (mock)
    - Colonnes: Name, Size, Status (Ready / Shared / Pending), Date, Actions
    - Footer: « 1–N of N »
    - Aucun détail technique (pas de CID/crypto dans la liste)

- File properties panel (overlay)
  - Ouvert au clic sur une ligne
  - Affiche CID (mock), « Shared with », permissions (mock)
  - Se ferme par clic extérieur / bouton / ESC
  - Principe de « progressive disclosure »: les infos techniques n’apparaissent qu’ici

- Robustesse & UX
  - Dark mode avec bordures plus contrastées
  - Fix hydratation Next.js: rendu différé après mount + suppressHydrationWarning pour les dates
  - Accessibilité de base (raccourci clavier Enter/Espace sur les zones cliquables, aria-label sur boutons d’icône)

---

## Comment tester

1) Lancer l’UI (port 1620)
- Démarrage simple:
  - `./dev.sh`
- Avec IPFS (optionnel, non requis pour l’UI mock):
  - `./dev.sh --with-ipfs`

2) Vérifier le health check
- Le script affiche:
  - `✅ Dev server is up and healthy at: http://localhost:1620`
  - Si IPFS indisponible:
    - `⚠️ IPFS unavailable — running in mock mode`

3) Scénario de test
- Ouvrir http://localhost:1620
- Vérifier la drop zone bleutée (drag-over renforce l’indication visuelle)
- Cliquer sur « Select Files » ou déposer un fichier:
  - Voir l’état « Processing… » (progress bar) puis « Done » (ou « Error » simulé)
  - Le fichier apparaît en tête de liste
- Cliquer sur une ligne pour ouvrir l’overlay Propriétés:
  - CID (mock), shared with, permissions
- Tester le toggle thème (☀️/🌙) et vérifier la persistance (rechargement de la page)

---

## Limites / out of scope

- Pas d’intégration réelle IPFS / chiffrement / wallet (tout est mock).
- Pas de persistance de la liste (refresh = réinitialisation).
- Bouton « … » (Actions) non implémenté (placeholder).
- A11y minimale (WAI-ARIA à renforcer si nécessaire).
- Pas de pagination réelle (footer informatif uniquement).
- Le rendu initial est différé post-mount pour éviter tout mismatch SSR/CSR (hypothèse acceptable en MVP demo).

---

## Lien vers le ProgDec associé

- Anytype (Space: « Sovereign Jedi ») — créer / lier un objet:
  - « ProgDec — Task 2: UI Skeleton (MVP) »
- Ce ProgDec doit contenir les décisions ci-dessous (format 6.3), référencées dans les commits et la présente doc.

---

## Décisions (extraits — voir ProgDec complet)

- ID: T02-D001  
  - Décision: Rendu différé post-mount pour éviter mismatch SSR/CSR  
  - Contexte: Erreurs d’hydratation (ex: dates, bouton icône conditionnel) au refresh  
  - Options: (A) Masquer partiel (uniquement dates) / (B) Différer l’UI complète  
  - Raison: (B) supprime les divergences SSR/CSR dans tous les cas  
  - Impact: Petit délai avant paint complet; UI hydratée stable  
  - Statut: Accepted

- ID: T02-D002  
  - Décision: Carte de drop dédiée (centrée) plutôt qu’un overlay pane-wide permanent  
  - Contexte: Guidage utilisateur, lisibilité, conformité au mock de référence  
  - Options: (A) Overlay pane-wide / (B) Carte dédiée  
  - Raison: (B) plus explicite et plus proche du visuel cible  
  - Impact: UX plus claire; interactions inchangées (drag & drop + clic)  
  - Statut: Accepted

- ID: T02-D003  
  - Décision: Toggle thème via icônes ☀️/🌙 avec persistance localStorage  
  - Contexte: Exigence de mode Light/Dark dans la spec 2.5 + cohérence visuelle  
  - Options: (A) Bouton texte / (B) Icône  
  - Raison: (B) lisible, compact et standard UX  
  - Impact: Améliore la découverte de la fonctionnalité, aucun impact sécu  
  - Statut: Accepted

- ID: T02-D004  
  - Décision: Renforcer le contraste des bordures en Dark Mode  
  - Contexte: Lisibilité insuffisante rapportée lors des tests de l’UI  
  - Options: (A) Garder tokens initiaux / (B) Augmenter contraste (#334155)  
  - Raison: (B) améliore lisibilité sans rompre l’esthétique  
  - Impact: Purement visuel; meilleure accessibilité  
  - Statut: Accepted

- ID: T02-D005  
  - Décision: Zone de drop bleutée (tint & border), accentuée en drag-over  
  - Contexte: Alignement visuel avec le mock de référence  
  - Options: (A) Style neutre / (B) Style bleuté  
  - Raison: (B) cohérence produit, statuts plus visibles  
  - Impact: Meilleure affordance; aucun impact sécu  
  - Statut: Accepted

---

## Références croisées (commits / scripts)

- Script d’exécution: `./dev.sh` (modes: simple et `--with-ipfs`)
- Port par défaut: 1620
- Messages de commit notables:
  - UI skeleton, drop zone, overlay, fix hydratation, thème icône, contraste dark

---

## Notes pour le README (impacts globaux)

- Ajouter une mention « One-command dev » (`./dev.sh` et `./dev.sh --with-ipfs`) dans la section « Développement local rapide ».
- Préciser que l’UI fonctionne sans IPFS (mock mode); l’option `--with-ipfs` est réservée aux tests d’intégration ultérieurs.
- Documenter le port 1620 et le message de succès du health check.
- Expliquer succinctement le principe de « progressive disclosure »: pas d’infos techniques en liste; détails visibles uniquement dans le panneau Propriétés.

---

## Annexes

- États UI (main panel / drop card):
  - idle → drag-over (overlay bleuté) → loading (progress bar) → success/error (capsules)
- Raccourcis:
  - Entrée / Espace: activer les zones cliquables (drop card)
  - ESC: fermer le panneau Propriétés
