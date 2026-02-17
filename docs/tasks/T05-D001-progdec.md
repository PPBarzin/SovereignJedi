# T05-D001 — ProgDec Task 05

## T05-D001
- Decision: Utiliser Helia/libp2p en navigateur avec bootstrap WebSocket vers un noeud local, configure par `NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS` (CSV de multiaddrs).
- Contexte: L'in-browser IPFS est fragile sans peer stable en dev; il faut une connectivite reproductible.
- Options considerees:
  - A: multiaddr locale `/ip4/127.0.0.1/tcp/15002/ws/p2p/{PEER_ID}` via noeud local.
  - B: endpoint distant/public direct.
- Raison: Option A offre la meilleure reproductibilite MVP et limite les aleas reseau.
- Impact:
  - Technique: necessite un noeud local libp2p disponible.
  - UX: setup dev explicite (copier/coller `PEER_ID`).
  - Securite: metadonnees reseau exposees au peer, mais contenu reste chiffre.
- Statut: Accepted.

## T05-D002
- Decision: Dans `EncryptedIpfsObjectV1`, `header` est exactement l'objet Task 4 `encryptedFile` (1:1), sans wrapper supplementaire.
- Contexte: la spec demande `header: Header` alors que Task 4 expose `EncryptedFile` sans champ `header` dedie.
- Options considerees:
  - A: `header = encryptedFile` (alias compatible).
  - B: ajouter un wrapper `{ header: encryptedFile }`.
- Raison: Option A evite une couche de serialisation inutile et minimise les risques d'incoherence.
- Impact:
  - Technique: alignement direct avec Task 4.
  - UX: aucun impact direct.
  - Securite: surface de transformation reduite.
- Statut: Accepted.

## T05-D003
- Decision: Calculer `integrity.sha256B64` sur l'objet sans `integrity`, puis uploader l'objet complet.
- Contexte: Eviter la circularite du hash.
- Options considerees:
  - A: hash sur `{version,header,envelope,payload}`.
  - B: hash sur ciphertext seul.
- Raison: Option A couvre l'ensemble du package chiffre (hors integrite auto-referencee).
- Impact:
  - Technique: verification locale robuste et deterministe.
  - Securite: defense en profondeur avec CID + AEAD + hash local.
- Statut: Accepted.

## T05-D004
- Decision: Mode upload MVP = Kubo HTTP API (IPFS Desktop), Helia browser devient fallback optionnel.
- Contexte: CID produit via Helia non recuperable par Kubo (block/stat timeout), absence de preuve d'interop “IPFS reel”.
- Options considerees:
  - A: Helia/libp2p browser comme mode principal (actuel).
  - B: Kubo HTTP API comme mode principal, Helia en fallback.
- Raison: Kubo offre une interop immediate avec `ipfs cat`, preuve realiste et reproductible.
- Impact:
  - Technique: ajout d’un client Kubo HTTP (POST /api/v0/add) et parsing NDJSON.
  - UX: affichage CID fiable et verifiable via `ipfs cat`.
  - Securite: aucun plaintext envoye (package chiffre uniquement).
- Statut: Accepted.
