> @sj/crypto@0.1.0 test /home/ppbarzin/Documents/Programmation/tools/SovereignJedi/packages/crypto
> vitest --run

The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v1.6.1 /home/ppbarzin/Documents/Programmation/tools/SovereignJedi/packages/crypto

stderr | tests/localEncryption.test.ts
libsodium-wrappers-sumo not resolvable from node_modules, will attempt local test-assets bundle.

stderr | tests/localEncryption.test.ts
<empty line>
stdout | tests/localEncryption.test.ts
libsodium loaded from local test-assets (file URL import) and attached to globalThis.sodium for tests

 ✓ tests/crypto.test.ts (5)
 ✓ tests/localEncryption.test.ts (13)

 Test Files  2 passed (2)
      Tests  18 passed (18)
   Start at  09:52:43
   Duration  772ms (transform 178ms, setup 0ms, collect 109ms, tests 229ms, environment 0ms, prepare 333ms)
```

Interprétation (liens avec OQ) :
- **OQ-01** (`prepareUnlock`) : couvert par les tests d’intégration du pipeline local (génération salt + message canonique).
- **OQ-02** (`deriveKekFromSignature`) : couvert par le test “KEK derivation determinism”.
- **OQ-03** (`encryptFile`) : couvert par les tests round-trip et structure envelope/header.
- **OQ-04** (round-trip) : couvert par “round-trip V3”.
- **OQ-05** (tamper) : couvert par “tamper tests” + “swap salt / walletPubKey / fileId”.
- **OQ-09** (metadata immuables) : couvert par les tests “immutable metadata: modifying … -> FAIL”.
- **OQ-10** (unicité fileId) : couvert par un test dédié **avec assertion explicite `fileId1 !== fileId2`** (voir §OQ-10 ci-dessous).

---

## OQ-10 — Preuve explicite (fileId1 !== fileId2)

### Nom du test (packages/crypto)
- `OQ-10: fileId uniqueness — encrypting same plaintext twice (same immutable metadata) yields different fileId`

Fichier :
- `packages/crypto/tests/localEncryption.test.ts`

### Extrait d’assertion (preuve)
```/dev/null/oq-10-assertion-excerpt.txt#L1-3
// Explicit OQ-10 assertion (direct comparison)
expect(resA.encryptedFile.fileId).not.toEqual(resB.encryptedFile.fileId);
```

### Output Vitest montrant que le test passe (preuve)
Voir l’output complet en tête de ce document (suite `packages/crypto`), et notamment :
- `✓ tests/localEncryption.test.ts (13)`
- `Tests  18 passed (18)`

---

### 3.2 Preuve — apps/web (exécution suite tests web)

Même si l’étape demandée est centrée crypto, la suite web a été exécutée pour s’assurer qu’il n’y a pas de régression globale.

Commande :
- `pnpm -C apps/web test`

Output complet :
```/dev/null/vitest-output-apps-web.txt#L1-16
> @sj/web@0.1.0 test /home/ppbarzin/Documents/Programmation/tools/SovereignJedi/apps/web
> vitest --run


 RUN  v1.6.1 /home/ppbarzin/Documents/Programmation/tools/SovereignJedi/apps/web

 ✓ tests/dummy.test.ts (1)
 ✓ src/lib/session/__tests__/SessionManager.test.ts (10)
 ✓ src/lib/session/__tests__/vaultGuards.test.ts (3)
 ✓ tests/wallet.test.ts (6)

 Test Files  4 passed (4)
      Tests  20 passed (20)
   Start at  09:47:52
   Duration  702ms (transform 194ms, setup 1ms, collect 348ms, tests 267ms, environment 0ms, prepare 631ms)
```

---

## 4) Détails de qualification par test (OQ)

### OQ-01 — Génération du message SJ_UNLOCK_V1 (`prepareUnlock`)
**Objectif** : message canonique + salt prêts à être signés.  
**Preuve** : suite `packages/crypto` OK (voir §3.1) ; tests d’intégration `localEncryption` exercent `prepareUnlock` avant dérivation KEK.  
**Résultat** : ✅ PASS.

### OQ-02 — Dérivation de la KEK (`deriveKekFromSignature`)
**Objectif** : déterminisme signature+salt, variation quand salt diffère.  
**Preuve** : test “KEK derivation determinism” dans `packages/crypto/tests/localEncryption.test.ts` (suite verte, §3.1).  
**Résultat** : ✅ PASS.

### OQ-03 — Chiffrement local (`encryptFile`)
**Objectif** : produire un payload chiffré + envelope, sans fuite, fileKey non persistée.  
**Preuve** : round-trip + tamper tests (suite verte, §3.1).  
**Résultat** : ✅ PASS.

### OQ-04 — Déchiffrement local round-trip
**Objectif** : bytes identiques entrée/sortie.  
**Preuve** : test “round-trip V3” (suite verte, §3.1).  
**Résultat** : ✅ PASS.

### OQ-05 — Résistance aux altérations internes (ciphertext / nonce / salt)
**Objectif** : toute altération doit faire échouer le decrypt.  
**Preuve** : tests de tamper (ciphertext/nonce) + swap salt (suite verte, §3.1).  
**Résultat** : ✅ PASS.

### OQ-09 — Intégrité des metadata immuables
**Objectif** : modifier `originalFileName`, `mimeType`, `fileSize`, `fileId` → decrypt FAIL.  
**Preuve** : tests “immutable metadata: modifying … -> FAIL” + test swap `fileId` (suite verte, §3.1).  
**Résultat** : ✅ PASS.

### OQ-10 — Unicité du fileId
**Objectif** : 2 encryptions du même fichier (mêmes metadata immuables) → `fileId` différent.  

**Preuve (test dédié + assertion explicite)**  
- **Test** : `OQ-10: fileId uniqueness — encrypting same plaintext twice (same immutable metadata) yields different fileId`  
- **Fichier** : `packages/crypto/tests/localEncryption.test.ts`  
- **Assertion (extrait)** :
```/dev/null/oq-10-assertion-excerpt.txt#L1-3
// Explicit OQ-10 assertion (direct comparison)
expect(resA.encryptedFile.fileId).not.toEqual(resB.encryptedFile.fileId);
```

**Preuve d’exécution** : l’output Vitest `packages/crypto` en tête de ce document montre que `tests/localEncryption.test.ts (13)` passe (18 tests au total).  

**Résultat** : ✅ PASS.

---

## 5) Sécurité — Non-persistance des secrets (confirmation)

- Aucun stockage persistant de **KEK**, **fileKey**, signature, seed, secret wallet dans `packages/crypto`.
- `fileId` et metadata header (originalFileName/mimeType/fileSize) sont **non secrets** et font partie des artefacts techniques.
- Le binding cryptographique des metadata immuables est assuré par `headerHash` dans le wrap AAD (recalculé dynamiquement), sans persister `headerHash` séparément.

---

## 6) Conclusion

Sur le périmètre demandé, la **qualification Étape 4** est **VALIDÉE** :

- ✅ OQ-01 / OQ-02 / OQ-03 / OQ-04 / OQ-05 / OQ-09 / OQ-10 : PASS  
- ✅ Tests automatisés verts (`packages/crypto` + `apps/web`)  
- ✅ Aucun secret persistant détecté dans le périmètre crypto

Ce rapport constitue la preuve d’exécution et de réussite des tests sélectionnés du protocole de qualification.

---
Fin du rapport.