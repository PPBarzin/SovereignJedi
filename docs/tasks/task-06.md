# Task 06 — User data layer (Manifest v1)

## Objectif
Mettre en place un **manifest chiffré** (inventaire) décrivant les fichiers chiffrés stockés sur IPFS, afin que l’UI **My files** reflète le manifest réel et que le wallet puisse “ouvrir” (décrypter) les entrées.

Résultat attendu (MVP) :
- À chaque upload (Task 5), une **entrée** est ajoutée au manifest.
- Le manifest est **chiffré côté client**, puis **uploadé sur IPFS**, donnant un **CID de manifest**.
- **My files** liste les entrées issues du manifest (plus de liste mock).

---

## Ce qui a été implémenté

### 1) IPFS download : `catBytes()` (pré-requis Task 6)
Ajout de la primitive de download de bytes par CID dans `@sj/ipfs`.

- Package : `packages/ipfs`
- API :
  - `addBytes(bytes: Uint8Array) -> Promise<{ cid: string, size: number }>` (déjà présent)
  - `catBytes(cid: string) -> Promise<Uint8Array>` (**ajout Task 6**)

Notes :
- Stratégie MVP : **Kubo-first** (`/api/v0/cat`) avec timeout ; fallback Helia `unixfs.cat()` si besoin.
- Tests : `packages/ipfs/tests/catBytes.test.ts`

---

### 2) Nouveau module `@sj/manifest` (Manifest v1)
Création d’un package dédié pour encapsuler :
- Types manifest
- Crypto manifest (derive key, encrypt/decrypt, integrity)
- Stockage du pointeur local (CID)
- Service de chargement/init et append (mutex in-tab)

Chemins :
- `packages/manifest/src/types.ts`
- `packages/manifest/src/crypto.ts`
- `packages/manifest/src/storage.ts`
- `packages/manifest/src/service.ts`
- `packages/manifest/src/internal/mutex.ts`

#### 2.1 Types (source-of-truth Envelope)
- Les entrées manifest stockent l’`envelope` **des fichiers** (Task 5).
- **Règle :** le type officiel est `Envelope` importé depuis `@sj/crypto`.
  - Pas d’alias exporté type `EncryptedEnvelopeV1`.
  - `ManifestEntryV1.envelope: Envelope`

#### 2.2 Pointeur local du manifest (MVP)
- Stockage : `localStorage`
- Key : `sj:manifestCid:<walletPubKey>`
- Valeur : `manifestCid` (string)
- Wrapper : `getManifestCid()` / `setManifestCid()` / `removeManifestCid()`

#### 2.3 Crypto manifest (alignement strict Task 5)
Le manifest est chiffré côté client :
- Chiffrement : **XChaCha20-Poly1305** via `libsodium-wrappers`
- AAD (AEAD) : canonicalization RFC8785 via `canonicalize` (même lib que Task 4/5)
- SHA-256 : via `@sj/crypto.sha256`

##### Dérivation de clé (séparation de contexte)
- `ManifestKey = HKDF(KEK, salt=null, info="SJ-MANIFEST-v1", length=32)`
- HKDF : `@sj/crypto.deriveKeyHKDF`

##### Integrity (règle identique à Task 5)
**Règle impérative :** strictement identique à `EncryptedIpfsObjectV1` (Task 5)
- Construire un `hashBasis` qui **exclut le champ** `integrity`
- Calculer : `sha256(TextEncoder().encode(JSON.stringify(hashBasis)))`
- Encoder en base64 → `integrity.sha256B64`

> Pas d’amélioration silencieuse (ex: pas de `canonicalize(hashBasis)`), car la cohérence interne prime.

#### 2.4 Concurrence (MVP)
- Mutex **in-tab (mémoire)** par wallet + stratégie `read → merge → write`
- Pas de lock multi-onglet en MVP (risque “last write wins” si deux onglets)

#### 2.5 Politique d’erreur (guardrail)
En cas d’erreur (IPFS KO, decrypt KO, integrity KO) :
- on bloque
- **on ne modifie pas** le pointeur local (`manifestCid`)
- **on n’upload pas** un nouveau manifest
- interdiction de régénérer un manifest vide automatiquement

---

### 3) Wiring UI : “My files” = manifest (plus de mock)
Le composant principal (page d’accueil) a été modifié pour :
- Charger le manifest lors d’un état “action vault autorisée” (Verified + VaultUnlocked)
- Remplacer la liste mock par les `manifest.entries`
- Après un upload Task 5, appeler `appendEntryAndPersist()` puis rafraîchir l’UI depuis le manifest

Fichier :
- `apps/web/pages/index.tsx`

Comportement :
- Tant que l’utilisateur n’est pas Verified + VaultUnlocked : la liste est vide (pas de décrypt attempt).
- Une fois unlock : `loadManifestOrInit()` est appelé (init si pas de CID).
- Après upload : append manifest, upload manifest, update pointeur, refresh “My files”.

---

## Comment tester (manuel)

### Prérequis
1) IPFS Kubo local
- Kubo API (par défaut) : `http://127.0.0.1:5001`
- Assure-toi que le daemon IPFS Kubo est démarré.

2) Config IPFS bootstrap (si utilisé côté Helia)
- Variable : `NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS` (CSV)
- Ex: `/ip4/127.0.0.1/tcp/15002/ws/p2p/<PEER_ID>`

3) Debug optionnel
- `NEXT_PUBLIC_SJ_DEBUG=true` active les logs debug (sinon pas de logs sensibles).

### Étapes
1. Lancer le front :
- `pnpm --filter @sj/web dev`

2. Dans l’UI :
- Connect wallet
- Sign to Verify
- Unlock Vault

3. Vérifier “My files” :
- Au premier unlock, si aucun pointeur local : init manifest → upload manifest → pointeur stocké.
- La liste doit être vide (manifest vide).

4. Upload d’un fichier (≤ 100MB) :
- Upload Task 5 produit un `fileCid`.
- Task 6 append une entrée dans le manifest et upload le manifest, puis met à jour le pointeur local.
- “My files” doit afficher le fichier (nom, taille si disponible, date, CID).

5. Refresh navigateur :
- Refaire Verify + Unlock
- “My files” doit refléter les entrées issues du manifest (pas de liste mock).

---

## Tests unitaires

### `@sj/ipfs`
- `pnpm -C packages/ipfs test`

### `@sj/manifest`
- `pnpm -C packages/manifest test`

### `@sj/web`
- `pnpm -C apps/web test`
- `pnpm -C apps/web typecheck`

---

## Limites / Out of scope (MVP)
- Pointeur cross-device : pas de stockage on-chain/IPNS (prévu futur)
- Concurrence multi-onglet : pas de verrou inter-tab
- Pinning/durabilité IPFS : hors scope (Task 11)
- Pagination/compaction du manifest : hors scope

---

## Lien ProgDec
- `docs/tasks/T06-D001-progdec.md`
