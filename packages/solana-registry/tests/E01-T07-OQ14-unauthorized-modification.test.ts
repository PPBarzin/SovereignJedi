import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as nacl from "tweetnacl";
import bs58 from "bs58";
import { getProgram, fetchRegistry } from '../src/index';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Fix Vitest/Libsodium issues
const sodium = require('libsodium-wrappers-sumo');
(globalThis as any).sodium = sodium;

/**
 * E01-T07-OQ14 — Unauthorized Wallet Cannot Modify Registry
 * 
 * Objective: 
 * Verify that a non-owner wallet cannot modify the registry of another wallet.
 */

describe('E01-T07-OQ14: Unauthorized Modification Rejection', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  
  // V1 fix: Deterministic keypairs via fixed seeds
  const ownerSeed = new Uint8Array(32).fill(0xAA);
  const intruderSeed = new Uint8Array(32).fill(0xBB);
  const ownerKp = nacl.sign.keyPair.fromSeed(ownerSeed);
  const intruderKp = nacl.sign.keyPair.fromSeed(intruderSeed);
  
  const owner = Keypair.fromSecretKey(ownerKp.secretKey);
  const intruder = Keypair.fromSecretKey(intruderKp.secretKey);

  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  const commitHash = "16bc1e06336f6a191a00f15c1c66265e74d38ece";
  const environment = "localnet (127.0.0.1:8899)";

  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ14');
  const jsonReportPath = path.join(evidenceDir, 'E01-T07-OQ14-results.json');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ14-results.md');

  const vaultId = "oq14-access-control-v1";
  const vaultIdHash = createHash('sha256').update(vaultId).digest();
  const cidOwner = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki";
  const cidIntruder = "bafybeig-intruder-entry-that-should-fail-v1";

  beforeAll(async () => {
    // Airdrop for both
    const sig1 = await connection.requestAirdrop(owner.publicKey, 2 * 1000000000);
    const sig2 = await connection.requestAirdrop(intruder.publicKey, 2 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig1, ...latestBlockhash });
    await connection.confirmTransaction({ signature: sig2, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  it('Strictly rejects modification of owner registry by intruder wallet', async () => {
    const ownerProgram = getProgram(connection, new anchor.Wallet(owner) as any, programId);
    const intruderProgram = getProgram(connection, new anchor.Wallet(intruder) as any, programId);

    const ownerRegistryPda = PublicKey.findProgramAddressSync(
      [Buffer.from('SJ_REGISTRY_V1'), owner.publicKey.toBuffer(), vaultIdHash],
      programId
    )[0];

    // 1. Initial State: Owner creates their registry
    console.log(`[E01-T07-OQ14] Step 1: Owner initializes registry...`);
    await ownerProgram.methods
      .initRegistry(vaultId, Array.from(vaultIdHash), 1)
      .accounts({
        registry: ownerRegistryPda,
        wallet: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();
    
    await ownerProgram.methods
      .appendManifest(Array.from(vaultIdHash), cidOwner, 1)
      .accounts({
        registry: ownerRegistryPda,
        wallet: owner.publicKey,
      } as any)
      .rpc();

    // V2 fix: Capture real dump BEFORE attack
    const registryBefore = await fetchRegistry(connection, owner.publicKey, vaultId, programId);
    expect(registryBefore?.entries.length).toBe(1);
    const dumpBefore = {
        entriesCount: registryBefore?.entries.length,
        lastCid: registryBefore?.entries[0].manifestCid,
        updatedAt: registryBefore?.updatedAt.toString()
    };
    console.log(`[E01-T07-OQ14] Registry initialized. Dump:`, dumpBefore);

    // 2. Intruder attempts to append to Owner's registry
    console.log(`[E01-T07-OQ14] Step 2: Intruder attempts to append to Owner registry...`);
    let capturedError: any = null;
    try {
      await intruderProgram.methods
        .appendManifest(Array.from(vaultIdHash), cidIntruder, 1)
        .accounts({
          registry: ownerRegistryPda, // TARGETING OWNER PDA
          wallet: intruder.publicKey,  // BUT USING INTRUDER SIGNER
        } as any)
        .rpc();
      
      expect.fail("Should have rejected unauthorized modification");
    } catch (err: any) {
      capturedError = err;
      console.log(`[E01-T07-OQ14] Captured expected rejection.`);
    }

    // V3 fix: Specific error detection
    const errStr = String(capturedError);
    const logs = capturedError?.logs || (capturedError?.transactionLogs ? capturedError.transactionLogs : []);
    const isConstraintError = errStr.includes('ConstraintSeeds') || errStr.includes('0x7d6');
    expect(isConstraintError).toBe(true);

    // 3. Final State: Capture real dump AFTER attack
    const registryAfter = await fetchRegistry(connection, owner.publicKey, vaultId, programId);
    const dumpAfter = {
        entriesCount: registryAfter?.entries.length,
        lastCid: registryAfter?.entries[0].manifestCid,
        updatedAt: registryAfter?.updatedAt.toString()
    };
    
    // V2 fix: Strict comparison based on real dumps
    const registryUnchanged = (dumpBefore.entriesCount === dumpAfter.entriesCount && 
                               dumpBefore.lastCid === dumpAfter.lastCid &&
                               dumpBefore.updatedAt === dumpAfter.updatedAt);
    
    expect(registryUnchanged).toBe(true);
    console.log(`[E01-T07-OQ14] Verified: Owner registry remains UNCHANGED. Dump:`, dumpAfter);

    // 4. Generate Artefacts
    const resultData = {
      testId: 'E01-T07-OQ14',
      timestamp: new Date().toISOString(),
      commitHash,
      environment,
      wallets: {
        owner: owner.publicKey.toBase58(),
        intruder: intruder.publicKey.toBase58()
      },
      vaultId,
      ownerPda: ownerRegistryPda.toBase58(),
      expectedError: 'ConstraintSeeds (0x7d6)',
      actualError: errStr.split('\n')[0],
      registryDumps: {
        beforeAttack: dumpBefore,
        afterAttack: dumpAfter
      },
      registryUnchanged,
      verdict: (isConstraintError && registryUnchanged) ? 'PASS' : 'FAIL',
      logs: logs
    };

    fs.writeFileSync(jsonReportPath, JSON.stringify(resultData, null, 2));

    let md = `# E01-T07-OQ14 — Unauthorized Wallet Modification Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Commit:** \`${commitHash}\`\n`;
    md += `**Environment:** \`${environment}\`\n`;
    md += `**Owner Wallet:** \`${resultData.wallets.owner}\`\n`;
    md += `**Intruder Wallet:** \`${resultData.wallets.intruder}\`\n`;
    md += `**Vault ID:** \`${vaultId}\`\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Vérifier qu'un wallet non propriétaire ne peut pas modifier le registry d'un autre wallet pour un \`vaultId\` donné.\n\n`;

    md += `## 2. Portée\n`;
    md += `Instruction \`append_manifest\` du programme \`sj_registry_program\`.\n\n`;

    md += `## 3. Préconditions\n`;
    md += `- Local validator actif.\n`;
    md += `- Registre existant créé par \`W_owner\` (seed fixe).\n`;
    md += `- \`W_intruder\` (seed fixe) financé et prêt à tenter une écriture.\n\n`;

    md += `## 4. Données de test\n`;
    md += `- **PDA cible (Owner) :** \`${resultData.ownerPda}\`\n`;
    md += `- **CID légitime :** \`${cidOwner}\`\n`;
    md += `- **CID intrus :** \`${cidIntruder}\`\n\n`;

    md += `## 5. Procédure\n`;
    md += `1. \`W_owner\` initialise son registre et ajoute une première entrée.\n`;
    md += `2. Capturer un dump complet de l'état du registre avant l'attaque.\n`;
    md += `3. \`W_intruder\` tente d'appeler \`append_manifest\` en passant le PDA de \`W_owner\` mais en signant avec sa propre clé.\n`;
    md += `4. Capturer l'erreur (attendue : \`ConstraintSeeds\` car le PDA ne correspond pas au dérivateur \`W_intruder\`).\n`;
    md += `5. Capturer un dump complet après l'attaque.\n`;
    md += `6. Comparer les deux dumps pour prouver l'absence totale de modification.\n\n`;

    md += `## 6. Résultat attendu\n`;
    md += `La tentative de \`W_intruder\` doit être rejetée on-chain. Le registre de \`W_owner\` doit rester strictement inchangé (dump avant == dump après).\n\n`;

    md += `## 7. Résultats observés\n\n`;
    
    md += `### 7.1 Comparaison des Dumps de Registre\n\n`;
    md += `| Propriété | État AVANT Attaque | État APRÈS Attaque |\n`;
    md += `| :--- | :--- | :--- |\n`;
    md += `| Entries Count | \`${dumpBefore.entriesCount}\` | \`${dumpAfter.entriesCount}\` |\n`;
    md += `| Last CID | \`${dumpBefore.lastCid}\` | \`${dumpAfter.lastCid}\` |\n`;
    md += `| Updated At | \`${dumpBefore.updatedAt}\` | \`${dumpAfter.updatedAt}\` |\n\n`;
    
    md += `**Verdict de comparaison :** ${registryUnchanged ? '✅ Inchangé' : '❌ ALTÉRÉ'}\n\n`;

    md += `### 7.2 Tentative d'intrusion (Négatif)\n\n`;
    md += `- **Result:** ❌ Transaction rejetée par Anchor (ConstraintSeeds)\n`;
    md += `- **Error Code:** \`0x7d6\` (ConstraintSeeds)\n`;
    
    if (logs.length > 0) {
      md += `<details><summary>Program Logs</summary>\n\n\`\`\`\n${logs.join('\n')}\n\`\`\`\n\n</details>\n\n`;
    }

    md += `## FINAL VERDICT: **${resultData.verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ14] Qualification report archived at: ${mdReportPath}`);
  }, 60000);
});
