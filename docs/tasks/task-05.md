# Task 05 — IPFS integration (files)

## Objectif
Permettre l'upload d'un package chiffre vers IPFS depuis le navigateur, recuperer son CID et l'afficher dans l'UI, en respectant les invariants de securite (pas de plaintext sortant, gating Verified + VaultUnlocked, hash local SHA-256).

## Ce qui a ete implemente
- Package `@sj/ipfs` cree (`packages/ipfs`) avec abstraction obligatoire:
  - `addBytes(bytes)`
  - `addEncryptedPackage(pkg)`
- Configuration WebSocket/libp2p MVP via multiaddr locale:
  - variable: `NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS` (CSV)
  - format attendu: `/ip4/127.0.0.1/tcp/15002/ws/p2p/{PEER_ID}`
- Orchestrateur web testable ajoute:
  - `apps/web/src/lib/ipfs/uploadEncryptedToIpfs.ts`
  - fonction: `uploadEncryptedToIpfsOrThrow(file, walletPubKey)`
- Flow applique:
  1. Verifie `IdentityVerified && VaultUnlocked`
  2. Verifie taille fichier `<= 100MB`
  3. Chiffre localement via Task 4 (`encryptFile`)
  4. Construit `EncryptedIpfsObjectV1`
  5. **Decision appliquee**: `header = encryptedFile` (1:1)
  6. Calcule `SHA-256(serialize({version,header,envelope,payload}))`
  7. Injecte `integrity.sha256B64`
  8. Upload via `@sj/ipfs`
  9. Retourne CID et l'affiche dans l'UI
- UI branchee dans `apps/web/pages/index.tsx`:
  - upload reelllement IPFS dans `handleFile`
  - affichage du CID apres succes
  - message de blocage >100MB

## Comment tester
1. Configurer un noeud libp2p local joignable en WebSocket et recuperer son `PEER_ID`.
2. Exporter la variable d'env:
   - `NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS=/ip4/127.0.0.1/tcp/15002/ws/p2p/<PEER_ID>`
3. Lancer l'app:
   - `pnpm --filter @sj/web dev`
4. Dans l'UI:
   - Connect wallet
   - Sign to Verify
   - Unlock Vault
   - Upload un fichier <= 100MB
5. Verifier:
   - statut succes
   - CID affiche
   - fichier >100MB bloque avec message explicite

Tests unitaires:
- `pnpm --filter @sj/ipfs test`
- `pnpm --filter @sj/web test`

## Limites / Out of scope
- Pas de pinning (Task 11)
- Pas de retrieval/decrypt par CID
- Pas de persistance decentralisee du CID (manifest)
- `PEER_ID` local renseigne manuellement (MVP)

## Lien ProgDec
- `docs/tasks/T05-D001-progdec.md`
