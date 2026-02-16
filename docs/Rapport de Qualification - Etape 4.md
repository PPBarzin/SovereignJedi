# Rapport de Qualification — Étape 4 (Task 4 — Local encryption pipeline)

> Ce rapport couvre uniquement les tests demandés du protocole de qualification (OQ-01, OQ-02, OQ-03, OQ-04, OQ-05, OQ-06, OQ-09, OQ-10) et annexe les preuves d’exécution.

---

## 1) Preuve — packages/crypto (exécution suite tests)

Commande :
- `pnpm -C packages/crypto test`

Output complet :
```/dev/null/vitest-output-packages-crypto.txt#L1-23
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
 ✓ tests/localEncryption.test.ts (14)

 Test Files  2 passed (2)
      Tests  19 passed (19)
   Start at  11:08:50
   Duration  827ms (transform 192ms, setup 0ms, collect 98ms, tests 214ms, environment 0ms, prepare 297ms)
```

---

## 2) Preuve — apps/web (exécution suite tests web)

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

## 3) Détails de qualification par test (OQ)

### OQ-01 — Génération du message SJ_UNLOCK_V1 (`prepareUnlock`)
**Objectif** : message canonique + salt prêts à être signés.  
**Preuve** : suite `packages/crypto` OK (voir §1). Les tests d’intégration `localEncryption` exercent `prepareUnlock` avant dérivation KEK.  
**Résultat** : ✅ PASS.

### OQ-02 — Dérivation de la KEK (`deriveKekFromSignature`)
**Objectif** : déterminisme signature+salt, variation quand salt diffère.  
**Preuve** : test “KEK derivation determinism” (suite verte, §1).  
**Résultat** : ✅ PASS.

### OQ-03 — Chiffrement local (`encryptFile`)
**Objectif** : produire un payload chiffré + envelope, sans fuite, fileKey non persistée.  
**Preuve** : round-trip + tamper tests (suite verte, §1).  
**Résultat** : ✅ PASS.

### OQ-04 — Déchiffrement local round-trip
**Objectif** : bytes identiques entrée/sortie.  
**Preuve** : test “round-trip V3” (suite verte, §1).  
**Résultat** : ✅ PASS.

### OQ-05 — Résistance aux altérations internes (ciphertext / nonce / salt)
**Objectif** : toute altération doit faire échouer le decrypt.  
**Preuve** : tests de tamper (ciphertext/nonce) + swap salt (suite verte, §1).  
**Résultat** : ✅ PASS.

### OQ-06 — Expiration du déverrouillage (refus hard avant dérivation KEK)
**Objectif** : un message `SJ_UNLOCK_V1` expiré doit être refusé **avant** la dérivation de la KEK.  

**Preuve (test dédié + refus hard)**  
- **Test** : `OQ-06: expired SJ_UNLOCK_V1 unlock message is refused before KEK derivation`  
- **Fichier** : `packages/crypto/tests/localEncryption.test.ts`  
- **Attendu** : throw contenant “expired”.

**Résultat** : ✅ PASS (voir §1 : `tests/localEncryption.test.ts (14)` passe, 19 tests au total).

### OQ-09 — Intégrité des metadata immuables
**Objectif** : modifier `originalFileName`, `mimeType`, `fileSize`, `fileId` → decrypt FAIL.  
**Preuve** : tests “immutable metadata: modifying … -> FAIL” + test swap `fileId` (suite verte, §1).  
**Résultat** : ✅ PASS.

### OQ-10 — Unicité du fileId (preuve explicite `fileId1 !== fileId2`)
**Objectif** : chiffrer deux fois le même fichier (mêmes metadata immuables) → `fileId` différent.  

**Nom du test (packages/crypto)**  
- `OQ-10: fileId uniqueness — encrypting same plaintext twice (same immutable metadata) yields different fileId`

**Extrait d’assertion (preuve)**  
```/dev/null/oq-10-assertion-excerpt.txt#L1-3
// Explicit OQ-10 assertion (direct comparison)
expect(resA.encryptedFile.fileId).not.toEqual(resB.encryptedFile.fileId);
```

**Preuve d’exécution**  
Voir l’output Vitest en §1 (suite `packages/crypto`) :
- `✓ tests/localEncryption.test.ts (14)`
- `Tests  19 passed (19)`

**Résultat** : ✅ PASS.

---

## 4) Sécurité — Non-persistance des secrets (confirmation)
- Aucun stockage persistant de **KEK**, **fileKey**, signature, seed, secret wallet dans `packages/crypto`.
- `fileId` et metadata header (originalFileName/mimeType/fileSize) sont **non secrets** et font partie des artefacts techniques.
- Le binding cryptographique des metadata immuables est assuré par `headerHash` dans le wrap AAD (recalculé dynamiquement), sans persister `headerHash` séparément.

---

## 5) Conclusion
Sur le périmètre demandé, la **qualification Étape 4** est **VALIDÉE** :

- ✅ OQ-01 / OQ-02 / OQ-03 / OQ-04 / OQ-05 / OQ-06 / OQ-09 / OQ-10 : PASS  
- ✅ Tests automatisés verts (`packages/crypto` + `apps/web`)  
- ✅ Aucun secret persistant détecté dans le périmètre crypto

---
Fin du rapport.