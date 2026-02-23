# ProgDec T07-D001 — Solana Registry Architecture

- **ID** : T07-D001
- **Décision** : Utilisation d'un PDA par (wallet, vaultId) avec historique de 32 entrées.
- **Contexte** : Nécessité de retrouver le dernier Manifest CID sans serveur centralisé.
- **Options considérées** :
  - A : NFT Metadata (Metaplex).
  - B : PDA Custom Registry.
- **Raison** : Option B est plus légère, moins coûteuse en frais de transaction (0.00x SOL), et évite les dépendances externes lourdes pour le MVP.
- **Impact** : Limite stricte à 32 versions par coffre (suffisant pour le MVP).
- **Statut** : Accepted

## Détails techniques
- Seeds : ["SJ_REGISTRY_V1", walletPubKey, sha256(vaultIdCanonical)]
- RegistryAccount Size: Fixée à l'initialisation pour 32 entries (Vec<RegistryEntry>).
