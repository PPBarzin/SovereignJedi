import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nacl from "tweetnacl";
import bs58 from "bs58";
import * as fs from 'fs';
import * as path from 'path';

import SessionManager from "../src/lib/session/SessionManager";

/**
 * E01-T07-OQ13 — Secrets Not Persisted Qualification Test
 * 
 * Objective: 
 * Verify that sensitive secrets (decryption keys, signatures) are NOT persisted 
 * in browser storage after unlock and session loss.
 */

describe("E01-T07-OQ13: Secrets Not Persisted", () => {
  const commitHash = "16bc1e06336f6a191a00f15c1c66265e74d38ece";
  const environment = "Unit/Integration with LocalStorage Mocks";
  
  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ13');
  const jsonReportPath = path.join(evidenceDir, 'E01-T07-OQ13-results.json');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ13-results.md');

  let storage: Record<string, string> = {};

  // Shared variables for artifact generation (V4 fix)
  let observed_vaultUnlockedBefore = false;
  let observed_vaultUnlockedAfter = false;
  let observed_secretsInStorage = true;
  let observed_reUnlockRequired = false;
  let observed_storageKeysBefore: string[] = [];
  let observed_storageKeysAfter: string[] = [];
  let observed_verifiedSignalStatus = 'FAIL';

  beforeEach(() => {
    storage = {};
    // @ts-ignore
    globalThis.localStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = String(val);
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        storage = {};
      },
      length: 0,
      key: (index: number) => Object.keys(storage)[index] || null,
    };

    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Verifies that secrets are lost on refresh and not persisted in storage", async () => {
    // V3 fix: Deterministic keypair
    const seed = new Uint8Array(32).fill(1); // fixed seed
    const kp = nacl.sign.keyPair.fromSeed(seed);
    const pubKey = bs58.encode(kp.publicKey);

    const sm = new SessionManager();

    console.log(`[E01-T07-OQ13] Step 1: Connecting wallet and unlocking vault...`);
    await sm.connectWallet(pubKey, "phantom");
    
    // Inject signer
    sm.setSigner(async (msg: Uint8Array) => {
      return nacl.sign.detached(msg, kp.secretKey);
    });

    await sm.unlockVault();
    
    // 1. Initial State Check
    observed_vaultUnlockedBefore = sm.isVaultUnlocked();
    expect(observed_vaultUnlockedBefore).toBe(true);
    
    // Capture sensitive material presence before refresh
    const sigBefore = sm.getLastUnlockSignatureBytes();
    expect(sigBefore).not.toBeNull();
    console.log(`[E01-T07-OQ13] Vault is UNLOCKED (Initial state). Signature bytes present in memory.`);

    // 2. Capture Storage State before refresh
    observed_storageKeysBefore = Object.keys(storage);
    console.log(`[E01-T07-OQ13] Storage keys found: ${observed_storageKeysBefore.join(', ')}`);

    // V2 fix: Strict whitelist check for sj_verified_v1
    const verifiedRaw = storage["sj_verified_v1"];
    expect(verifiedRaw).toBeDefined();
    const verifiedParsed = JSON.parse(verifiedRaw);
    
    const allowedFields = ['walletPubKey', 'verifiedAt', 'expiresAt', 'walletProvider', 'nonce', 'issuedAt'];
    const actualFields = Object.keys(verifiedParsed);
    const forbiddenFields = actualFields.filter(f => !allowedFields.includes(f));
    
    console.log(`[E01-T07-OQ13] Verifying fields in sj_verified_v1: ${actualFields.join(', ')}`);
    expect(forbiddenFields.length).toBe(0);
    
    // Deep content check: ensure no binary-like or long strings that could be secrets
    let secretsFound = false;
    for (const [key, value] of Object.entries(verifiedParsed)) {
        if (typeof value === 'string' && value.length > 64 && key !== 'walletPubKey') {
            console.error(`[E01-T07-OQ13] SUSPICIOUS field found: ${key} (length ${value.length})`);
            secretsFound = true;
        }
    }
    observed_secretsInStorage = secretsFound;
    expect(secretsFound).toBe(false);
    observed_verifiedSignalStatus = 'PASS';

    // 3. Simulate Refresh (Create new instance, but keep localStorage)
    console.log(`[E01-T07-OQ13] Step 2: Simulating refresh (new SessionManager)...`);
    const smNew = new SessionManager();
    
    // 4. Verification after refresh (Step 6 of protocol)
    observed_vaultUnlockedAfter = smNew.isVaultUnlocked();
    expect(observed_vaultUnlockedAfter).toBe(false);

    // V1 fix: Proof of inaccessibility (Step 6)
    const sigAfter = smNew.getLastUnlockSignatureBytes();
    const vaultRootSigAfter = smNew.getLastVaultRootSignatureBytes();
    
    console.log(`[E01-T07-OQ13] Step 6 Check: getLastUnlockSignatureBytes() -> ${sigAfter}`);
    expect(sigAfter).toBeNull();
    expect(vaultRootSigAfter).toBeNull();
    
    observed_reUnlockRequired = (sigAfter === null && !smNew.isVaultUnlocked());
    console.log(`[E01-T07-OQ13] Verified: Vault is LOCKED and secrets are inaccessible after refresh.`);

    observed_storageKeysAfter = Object.keys(storage);

    // 5. Generate Evidence
    const resultData = {
      testId: 'E01-T07-OQ13',
      timestamp: new Date().toISOString(),
      commitHash,
      environment,
      walletPubKey: pubKey,
      beforeRefresh: {
        vaultUnlocked: observed_vaultUnlockedBefore,
        storageKeys: observed_storageKeysBefore,
        hasMemorySecrets: sigBefore !== null
      },
      afterRefresh: {
        vaultUnlocked: observed_vaultUnlockedAfter,
        storageKeys: observed_storageKeysAfter,
        hasMemorySecrets: sigAfter !== null
      },
      securityCheck: {
        secretsInStorage: observed_secretsInStorage,
        reUnlockRequired: observed_reUnlockRequired,
        verifiedSignalWhitelist: observed_verifiedSignalStatus
      },
      verdict: (observed_reUnlockRequired && !observed_secretsInStorage && observed_verifiedSignalStatus === 'PASS') ? 'PASS' : 'FAIL'
    };

    fs.writeFileSync(jsonReportPath, JSON.stringify(resultData, null, 2));

    let md = `# E01-T07-OQ13 — Secrets Not Persisted Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Commit:** \`${commitHash}\`\n`;
    md += `**Environment:** \`${environment}\`\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Vérifier qu'après déverrouillage du vault puis perte de session applicative (refresh), les secrets nécessaires au déchiffrement ne restent pas persistés dans les stockages navigateur interdits.\n\n`;

    md += `## 2. Portée\n`;
    md += `- \`SessionManager\` (apps/web/src/lib/session/SessionManager.ts)\n`;
    md += `- Gestion du stockage local (\`localStorage\`)\n\n`;

    md += `## 3. Préconditions\n`;
    md += `- Simulation du \`localStorage\` via mock dans l'environnement de test.\n`;
    md += `- Wallet de test déterministe (Ed25519) via seed fixe pour répétabilité (§9).\n\n`;

    md += `## 4. Données de test\n`;
    md += `- **Wallet PubKey :** \`${pubKey}\` (Déterministe)\n`;
    md += `- **Clé de stockage attendue :** \`sj_verified_v1\`\n\n`;

    md += `## 5. Procédure\n`;
    md += `1. Connecter le wallet (seed fixe) et déverrouiller le vault.\n`;
    md += `2. Vérifier que l'état \`isVaultUnlocked()\` est \`true\` et que les secrets de session sont présents en mémoire.\n`;
    md += `3. Inspecter le \`localStorage\` via une whitelist stricte des champs attendus dans \`sj_verified_v1\`.\n`;
    md += `4. Vérifier qu'aucun champ non-autorisé (ex: signature, kek, secret) n'est présent.\n`;
    md += `5. Simuler un refresh (nouvelle instance \`SessionManager\`).\n`;
    md += `6. **Step 6 Protocol :** Tenter l'accès aux secrets via \`getLastUnlockSignatureBytes()\`.\n`;
    md += `7. Vérifier que l'accès retourne \`null\` et que le vault est verrouillé.\n\n`;

    md += `## 6. Résultat attendu\n`;
    md += `- Avant refresh : Vault déverrouillé, secrets accessibles en mémoire.\n`;
    md += `- Après refresh : Vault verrouillé, secrets INACCESSIBLES (null).\n`;
    md += `- Aucun secret sensible trouvé dans \`localStorage\` (vérifié par whitelist).\n\n`;

    md += `## 7. Résultats observés\n\n`;
    
    md += `### 7.1 État avant Refresh\n\n`;
    md += `- **Vault Unlocked :** \`${resultData.beforeRefresh.vaultUnlocked}\` ✅\n`;
    md += `- **Secrets en mémoire (Signatures) :** ✅ Présents\n`;
    md += `- **Clés dans localStorage :** \`${resultData.beforeRefresh.storageKeys.join(', ')}\`\n`;
    md += `- **Audit \`sj_verified_v1\` :** Whitelist respectée, aucun secret détecté ✅\n\n`;

    md += `### 7.2 État après Refresh (Preuve d'inaccessibilité)\n\n`;
    md += `- **Vault Unlocked :** \`${resultData.afterRefresh.vaultUnlocked}\` ✅ (L'accès est perdu)\n`;
    md += `- **\`getLastUnlockSignatureBytes()\` :** \`null\` ✅ (Step 6 : Preuve que les secrets sont perdus)\n`;
    md += `- **Clés persistantes :** \`${resultData.afterRefresh.storageKeys.join(', ')}\`\n\n`;
    
    md += `## FINAL VERDICT: **${resultData.verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ13] Qualification report archived at: ${mdReportPath}`);
    
    expect(resultData.verdict).toBe('PASS');
  }, 30000);
});
