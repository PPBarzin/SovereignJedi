# Wallet components & utilities (Task 03 — Wallet connection)

This folder contains React components and small utilities to implement the Task 3 requirements:
- Connect a Solana wallet (Phantom) on `devnet` by default.
- Display the connected address (truncated + copy).
- Request a message signature for a proof-of-control (non-transaction).
- Verify the signature locally and persist a minimal `identity` object in `localStorage`.
- Enforce upload gating until `verified = true` and `now <= expiresAt`.

Refer to the Task definition in the project space (Task: `3. Wallet connection (Solana)`) and decision log `T03-D001` (ProgDec).

Contents
- `ConnectWallet.tsx` — connect / disconnect UI and wallet detection.
- `VerifyWallet.tsx` — builds the proof message, requests signature, verifies locally and persists identity.
- `IdentityStatus.tsx` — shows current state: `DISCONNECTED`, `CONNECTED_UNVERIFIED`, `CONNECTED_VERIFIED`.
- `utils.ts` — helper utilities (message builder, signature verification, TTL computation, storage helpers).
- `types.ts` — TypeScript shapes (Identity, IdentityStorage).
- `README.md` (this file).

Design decisions (implemented)
- Wallet stack: `@solana/wallet-adapter-*` + `@solana/web3.js` (see ProgDec `T03-D001`).
- Default cluster: `devnet`. Overridable via `NEXT_PUBLIC_SOLANA_CLUSTER`.
- Domain in message: `window.location.host` by default; override with `NEXT_PUBLIC_APP_DOMAIN`.
- Proof TTL: `24h` default; internal env `PROOF_TTL_SECONDS` with client exposure `NEXT_PUBLIC_PROOF_TTL_SECONDS` if needed.
- Persistence keys in `localStorage`: `sj_lastWalletProvider`, `sj_identity`.

Message format (stable, human readable)
The message signed by the wallet must include the following fields in a stable order (text plain):
- `domain`: e.g. `app.sovereignjedi.xyz` or `localhost`
- `publicKey`: string (base58)
- `statement`: "Prove you control this wallet for Sovereign Jedi"
- `nonce`: random hex or base64 (>= 16 bytes), regenerated each verify
- `issuedAt`: ISO timestamp
- `chain`: `solana:<cluster>` (e.g. `solana:devnet`)
- `purpose`: `proof_of_control`

Example message (pseudo)
```
Sovereign Jedi — Proof of Control
domain: localhost:1620
publicKey: 3N4...AbC
statement: Prove you control this wallet for Sovereign Jedi
nonce: 4b8f6a9c8f3e...
issuedAt: 2026-01-10T09:00:00Z
chain: solana:devnet
purpose: proof_of_control
```

Identity object persisted in `localStorage` (key `sj_identity`)
- `publicKey` (string)
- `message` (string) — full signed message
- `signature` (base58 string)
- `issuedAt` (ISO string)
- `verifiedAt` (ISO string)
- `expiresAt` (ISO string)
- `nonce` (string)
- `cluster` (string)
- `domain` (string)

LocalStorage helper keys
- `sj_lastWalletProvider` — string (e.g. `"phantom"`)
- `sj_identity` — JSON object described above

State machine
- `DISCONNECTED`
- `CONNECTED_UNVERIFIED`
- `CONNECTED_VERIFIED`
- `ERROR` (transient)

UX flows implemented
- Connect flow:
  - Click `Connect wallet`.
  - If no Phantom extension is detected, show CTA to install Phantom and helpful link.
  - If Phantom is present, open its connect modal.
  - On success, show truncated address and a `Verify` button if not verified.
- Verify flow:
  - Build message (see format), ask Phantom to sign the message.
  - Verify signature locally with `@solana/web3.js` utilities.
  - On success, persist `sj_identity` (with TTL) and update UI to `CONNECTED_VERIFIED`.
- Upload gating:
  - Components that start an upload must check identity:
    - if missing or expired: block and show a toast/drawer prompting `Verify now`.
    - else: allow.
- Disconnect / wallet change:
  - If wallet disconnects or the publicKey changes externally, the app will clear `sj_identity`, set `DISCONNECTED`, and show a message: "Wallet changed — please reconnect".

Integration notes
- Replace the mock wallet UI in `apps/web/pages/index.tsx` with the new components:
  - Import and render `<ConnectWallet />`, `<IdentityStatus />`.
  - Ensure upload components depend on the identity utility to gate uploads.
- The `apps/web/src` folder is the canonical place for components; the wallet components live under:
  - `apps/web/src/components/wallet/`

Env variables (recommended)
- `NEXT_PUBLIC_SOLANA_CLUSTER` — `devnet` (default). Example: `devnet` or `mainnet-beta`.
- `PROOF_TTL_SECONDS` — internal default (86400). To change TTL server-side/build-time.
- `NEXT_PUBLIC_PROOF_TTL_SECONDS` — optional exposure to client if runtime UI needs to know TTL.
- `NEXT_PUBLIC_APP_DOMAIN` — optional override for `domain` inside the proof message.

Testing
- Unit tests (vitest) to include:
  - `utils.buildProofMessage()` — deterministic format test.
  - `utils.verifySignature()` — verify signature logic (mock known publicKey/message/signature).
  - TTL calculation and expiry detection.
  - Upload gating logic (given identity states).
- Manual test steps:
  1. Run the app: `pnpm --filter @sj/web dev` (Next runs on `:1620` per package scripts).
  2. Open `http://localhost:1620`.
  3. Ensure Phantom extension is installed and set to devnet cluster.
  4. Click `Connect wallet` → approve in Phantom → address shown (truncated).
  5. Click `Verify` → sign the message in Phantom → UI should change to `Verified`, showing `verifiedAt` and `expiresAt`.
  6. Try uploading a file — should be allowed when verified; block when not verified.
  7. Wait past TTL (or change TTL to a low value) → confirm state reverts to `CONNECTED_UNVERIFIED` and upload is blocked.
  8. Change account in Phantom (account switch) → app should detect change and force disconnect with the message "Wallet changed — please reconnect".
  9. Disconnect from the UI → confirm `sj_identity` cleared and upload blocked.

Acceptance checklist (DoD)
- [ ] FR/NFR implemented (see Task 3 spec).
- [ ] Branch: `task-03-wallet-connection` (created).
- [ ] Unit tests for signature verification, TTL, gating, reset on wallet change.
- [ ] Manual flows A/B/C/D verified by QA (steps above).
- [ ] `docs/tasks/task-03-wallet-connection.md` created with manual test instructions and DoD checklist.
- [ ] `ProgDec` `T03-D001` created and linked to the task (already recorded in the space).
- [ ] No secrets (private keys or seeds) are persisted anywhere.
- [ ] Local storage limited to `sj_lastWalletProvider` and `sj_identity`.

Developer notes / gotchas
- Phantom signs arbitrary messages using `signMessage` which returns `Uint8Array` — convert to base58 for storage.
- Use `@solana/web3.js` `Keypair` / `PublicKey` or `nacl` helpers to verify signatures according to the wallet-adapter recommended approach.
- Some wallet-adapter peer dependency warnings may appear during install — these are known for some optional adapters; we only use Phantom.
- Always show an explicit message in the UI: "This signature is free and is NOT a transaction" to reduce user confusion.

Where to look next
- Implementations live under: `apps/web/src/components/wallet/`
- Replace mock in: `apps/web/pages/index.tsx`
- Add `docs/tasks/task-03-wallet-connection.md` for the task deliverables and manual testing instructions.

If you want, I can now:
- produce the exact TypeScript source files for each component and utility (one file per message),
- or produce the `docs/tasks/task-03-wallet-connection.md` with manual test instructions and the DoD checklist filled in.
Tell me which file to create first.