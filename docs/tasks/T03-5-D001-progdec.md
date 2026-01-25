Sovereign Jedi — ProgDec T03-5-D001
===================================

ID
--
T03-5-D001

Titre
-----
Séparation stricte : Proof-of-control (IdentityVerified) ≠ VaultUnlocked (session) — contrat d'accès pour Task 3.5

Décision
--------
Pour l'itération Task 3.5, nous actons et standardisons le contrat suivant :

- Proof-of-control (alias IdentityVerified)
  - Est une preuve signée, non-transactionnelle, persistable côté client (TTL configurable).
  - Représentée par l'objet stocké `sj_identity` (format Identity) et un signal léger `sj_verified_v1` (métadonnées non sensibles).
  - Sert uniquement à prouver la propriété du wallet (identité). C'est un signal UX/anti-friction, pas une autorisation de ressources sensibles.

- VaultUnlocked (session)
  - Est un état strictement en mémoire côté client (SessionManager).
  - Autorise l'accès aux actions sensibles (upload, accès contenu protégé, actions protégées).
  - Est obtenu via une signature dédiée (message canonique V1) et validée client-side par `SessionManager.unlockVault()`.
  - Est perdu à la fin de la session navigateur (refresh/close) ou sur `disconnect` / `accountChanged`.
  - Ne doit jamais être persistant.

En synthèse : IdentityVerified ≠ VaultUnlocked. Aucune action de vault n'est autorisée si VaultUnlocked === false, même si IdentityVerified === true.

Contexte et motivations
-----------------------
- Objectif Task 3.5 : définir et valider le contrat d'accès sécurisé (session + Vault) sans implémenter la cryptographie serveur ou persister de secrets.
- Besoin produit : UX simple (vérifier identité pour confort), sécurité minimale (unlock explicite pour action sensible), traçabilité des décisions (ProgDec).
- Erreurs observées fréquemment : confusion entre preuve d'identité et autorisation d'accès ; persistances accidentelles de secrets ; accès implicite au vault après seule vérification.

Options considérées
--------------------
Option A — Séparation stricte (choisie)
- Proof-of-control persistable (sj_identity), VaultUnlocked strictement mémoire.
- Unlock explicite via signature dédiée. Upload/action protégée vérifient seulement VaultUnlocked.
- Clear identity ne déverrouille pas la wallet ; mais doit révoquer l'accès au vault (on lockVault()).
- Disconnect provider => session.disconnectWallet() (relock, clear pubkey).

Option B — Fusion Verify = Unlock
- La vérification (Sign to Verify) déverrouille aussi automatiquement le vault.
- Simplifie l'UX (moins de boutons) mais rend la sécurité plus fragile et crée une différence sémantique entre preuve et autorisation.
- Rejetée pour Task 3.5 (prévue pour Task 4 si besoin d'évolution).

Option C — Persister VaultUnlocked (ex: sessionStorage)
- Rend l'UX plus durable mais introduit stockage de flag autorisant actions sensibles ; risque de sécurité local.
- Rejetée : Task 3.5 exige VaultUnlocked éphémère (mémoire).

Raisons du choix (Option A)
---------------------------
- Respect du principe de moindre privilège : la preuve d'identité ne donne pas automatiquement accès à des opérations sensibles.
- Plus explicitement testable pour OQ : presence d'une action explicite "Unlock Vault" facilite le protocole de test.
- Prépare une migration propre vers Task 4, où la KEK / cryptographie réelle pourra s'intégrer sans changer les flux UX/contrats.
- Minimise la surface d'attaque : aucun flag d'autorisation persistant susceptible d'être manipulé par un attaquant local.

Impact technique (liste d'impacts explicites)
---------------------------------------------
- SessionManager (client) : API contractuelle requise et utilisée :
  - `connectWallet(pubKey, provider)`
  - `disconnectWallet()`
  - `unlockVault(): Promise<void>`
  - `lockVault()`
  - `isWalletConnected(): boolean`
  - `isVaultUnlocked(): boolean` (ou équivalent exposé au hook)
  - `getVerified(): VerifiedState | null`
- Stockage local :
  - `sj_identity` : Identity object (persisted proof-of-control)
  - `sj_verified_v1` : signal non-sensible sauvegardé par SessionManager après unlock verification (metadata only)
  - Aucune persistance de secrets privés/keys/Keks.
- UI :
  - `VerifyWallet` : fait uniquement la preuve d'identité (write `sj_identity`), NE DOIT PAS appeler `unlockVault()`.
  - `UnlockVaultButton` : unique déclencheur d'`unlockVault()` (doit être visible de façon proéminente).
  - `ProtectedAction` / dropzone / upload handlers : vérifient exclusivement `session.isVaultUnlocked` avant d'autoriser l'action.
  - `Clear identity` : supprime `sj_identity` et doit appeler `session.lockVault()` (révocation d'accès) mais ne doit pas déconnecter la wallet.
  - `Disconnect wallet` / `accountChanged` : doit appeler `session.disconnectWallet()` et clear identity (revoke).
- Tests :
  - Unit tests pour `SessionManager` (déjà présents).
  - Tests d'intégration / OQ : connect → verify → unlock → upload → refresh → disconnect paths.
- Documentation :
  - ProgDec (ce fichier) doit être lié au dossier `docs/tasks` et à l'espace Anytype (objet `ProgDec` T03-5-D001) pour traçabilité.

Plan d'implémentation / instructions pour les devs
--------------------------------------------------
1. Implémenter `SessionManager` (déjà fait) et s'assurer que `unlockVault()` :
   - demande la signature du message canonique :
     ```
     SOVEREIGN_JEDI_UNLOCK_VAULT_V1
     Cette signature déverrouille temporairement votre coffre pour la session en cours.
     ```
   - vérifie la signature client-side (tweetnacl) avec la pubkey du wallet.
   - sur succès, positionne `vaultUnlocked = true` en mémoire et persiste uniquement `sj_verified_v1` (méta), contenant : `{ walletPubKey, verifiedAt, expiresAt, walletProvider? }`.
2. Hook `useSession()` : wrapper léger qui expose les méthodes et l'état pour l'UI, et installe des listeners :
   - `window.solana.on('accountChanged', ...)` ⇒ appeler `session.disconnectWallet()` (NO HOT-SWITCH).
   - `window.solana.on('disconnect')` ⇒ `session.disconnectWallet()`, clear identity.
   - `window.addEventListener('storage', ...)` pour resync `sj_verified_v1` si besoin.
3. UI rules (strictes) :
   - `VerifyWallet` : build message, sign, verify locally, persist `sj_identity` (Identity) and notify parent via `onVerified`.
   - `UnlockVaultButton` : visible when wallet pubkey or provider present; on click, call `unlockVault()`; UI must reflect loading & error messages.
   - `ProtectedAction` : must check `isVaultUnlocked` and refuse with explicit guidance if false (do NOT call unlock).
   - Upload/Dropzone/Picker : must check `isVaultUnlocked` (guard client-side) and disable UI affordances when false.
   - `Clear identity` : remove `sj_identity`, call `session.lockVault()`, refresh UI state; do NOT call `disconnectWallet()`.
   - `Disconnect wallet` : call `session.disconnectWallet()`, clear identity, refresh UI state.
4. Testing:
   - Unit tests for SessionManager methods (connect, unlock, lock, disconnect).
   - Manual OQ script (to be used by tester):
     1. Start page with wallet disconnected → try ProtectedAction: must fail.
     2. Connect wallet (Phantom) → Verify: sign → Identity stored.
     3. Unlock Vault via Unlock button → sign → `VaultUnlocked=true`.
     4. Upload file → allowed.
     5. Refresh page → `vaultUnlocked=false`, upload blocked.
     6. Reconnect or account change → `vaultUnlocked=false`, identity cleared, upload blocked.

Definition of Done (DoD)
------------------------
- Code:
  - SessionManager implemented and tested (unit tests).
  - UI components updated per rules above.
- Security:
  - No secret or private key is persisted anywhere.
- UX:
  - Unlock button visible and prominently discoverable.
  - Clear identity revokes vault access without disconnecting wallet.
- Docs:
  - ProgDec T03-5-D001 created in docs/tasks (this file).
  - Anytype ProgDec object created in project space with same ID and content summary, linked to this task.
- Tests:
  - Automated tests pass (unit + typecheck).
  - Manual OQ steps produce expected results.
- Git:
  - Changes are committed on branch `task-3.5-session-manager` and pushed to origin.

Rollback criteria
-----------------
- If any change causes an unintended exposure of secrets or persistent vaultUnlocked state, revert to previous commit and open a security review.
- If a regression breaks basic wallet connect/verify/unlock flow, revert and investigate.

References (code pointers)
--------------------------
- SessionManager implementation: `apps/web/src/lib/session/SessionManager.ts`
- Hook wrapper: `apps/web/src/lib/session/useSession.ts`
- UI: `apps/web/src/components/wallet/ConnectWallet.tsx`, `VerifyWallet.tsx`, `IdentityStatus.tsx`, `UnlockVaultButton.tsx`, `ProtectedAction.tsx`
- Docs (tasks folder): `docs/tasks/*` (this ProgDec file: `docs/tasks/T03-5-D001-progdec.md`)

Ownership
---------
- Decision owner: Product / Security lead (delegate to engineering for enforcement)
- Implementation owner: Frontend engineering team (branch: `task-3.5-session-manager`)
- Reviewer: Security / QA

Statut
------
Accepted — implemented (see branch `task-3.5-session-manager`).

Notes additionnelles
--------------------
- Cette ProgDec est volontairement conservatrice : elle formalise une séparation de responsabilités utile pour itérer vers Task 4 (cryptography, KEK, offline storage) sans changer les API UX.
- Toute modification future visant à fusionner Verified → Unlock devra repasser par un ProgDec et une évaluation sécurité.
