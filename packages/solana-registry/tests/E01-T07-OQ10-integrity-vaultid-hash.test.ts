import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getProgram, fetchRegistry } from '../src/index';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Fix Vitest/Libsodium issues
const sodium = require('libsodium-wrappers-sumo');
(globalThis as any).sodium = sodium;

/**
 * E01-T07-OQ10 — VaultId Hash Consistency Qualification Test
 * 
 * Objective: 
 * Verify that the registry strictly rejects an inconsistent vaultIdHash.
 */

describe('E01-T07-OQ10: VaultId Hash Consistency', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const payer = Keypair.generate();
  const wallet = new anchor.Wallet(payer);
  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  const commitHash = "16bc1e06336f6a191a00f15c1c66265e74d38ece";
  const environment = "localnet (127.0.0.1:8899)";

  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ10');
  const jsonReportPath = path.join(evidenceDir, 'E01-T07-OQ10-results.json');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ10-results.md');

  // V1 - Repeatability: use a deterministic vaultId
  const vaultId = "oq10-integrity-test-vector-v1";

  beforeAll(async () => {
    const sig = await connection.requestAirdrop(payer.publicKey, 5 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  it('Strictly rejects inconsistent vaultIdHash and prevents registry creation', async () => {
    const program = getProgram(connection, wallet as any, programId);
    
    // 1. Calculate valid hash
    const vaultIdHash_valid = createHash('sha256').update(vaultId).digest();
    
    // 2. Forge an invalid hash (hash of another string)
    const vaultIdHash_invalid = createHash('sha256').update(vaultId + "-forged").digest();

    console.log(`[E01-T07-OQ10] Testing with vaultId: ${vaultId}`);
    console.log(`[E01-T07-OQ10] Valid Hash: ${vaultIdHash_valid.toString('hex')}`);
    console.log(`[E01-T07-OQ10] Forged Hash: ${vaultIdHash_invalid.toString('hex')}`);

    // 3. Attempt init_registry with INVALID hash
    let capturedError: any = null;
    try {
      await program.methods
        .initRegistry(vaultId, Array.from(vaultIdHash_invalid), 1)
        .accounts({
          registry: PublicKey.findProgramAddressSync(
            [Buffer.from('SJ_REGISTRY_V1'), payer.publicKey.toBuffer(), vaultIdHash_invalid],
            programId
          )[0],
          wallet: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();
      
      expect.fail("Should have rejected inconsistent hash");
    } catch (err: any) {
      capturedError = err;
      console.log(`[E01-T07-OQ10] Captured expected rejection.`);
    }

    // Verify error code (0x1773 = 6003 = InvalidVaultIdHash)
    const errStr = String(capturedError);
    const logs = capturedError?.logs || (capturedError?.transactionLogs ? capturedError.transactionLogs : []);
    const isIntegrityError = errStr.includes('0x1773') || errStr.includes('6003') || errStr.includes('InvalidVaultIdHash');
    expect(isIntegrityError).toBe(true);

    // 4. Verify no registry was created for this PDA
    const forgedPda = PublicKey.findProgramAddressSync(
      [Buffer.from('SJ_REGISTRY_V1'), payer.publicKey.toBuffer(), vaultIdHash_invalid],
      programId
    )[0];
    const accountInfo = await connection.getAccountInfo(forgedPda);
    expect(accountInfo).toBeNull();
    console.log(`[E01-T07-OQ10] Verified: No account exists at forged PDA.`);

    // 5. Positive Control: Verify that a valid hash works (with a different vaultId to be clean)
    const vaultId_control = vaultId + "-ok";
    const vaultIdHash_control = createHash('sha256').update(vaultId_control).digest();
    const sigControl = await program.methods
      .initRegistry(vaultId_control, Array.from(vaultIdHash_control), 1)
      .accounts({
        registry: PublicKey.findProgramAddressSync(
          [Buffer.from('SJ_REGISTRY_V1'), payer.publicKey.toBuffer(), vaultIdHash_control],
          programId
        )[0],
        wallet: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();
    
    expect(sigControl).toBeDefined();
    const controlRegistry = await fetchRegistry(connection, payer.publicKey, vaultId_control, programId);
    expect(controlRegistry).not.toBeNull();
    console.log(`[E01-T07-OQ10] Positive control success: Valid hash accepted.`);

    // 6. Generate Artefacts
    const resultData = {
      testId: 'E01-T07-OQ10',
      timestamp: new Date().toISOString(),
      commitHash,
      environment,
      wallet: payer.publicKey.toBase58(),
      vaultId_test: vaultId,
      vaultIdHash_valid: vaultIdHash_valid.toString('hex'),
      vaultIdHash_invalid: vaultIdHash_invalid.toString('hex'),
      expectedError: 'InvalidVaultIdHash (6003 / 0x1773)',
      actualError: errStr.split('\n')[0],
      pdaExists: accountInfo !== null, // V4 - Semantically corrected (false)
      controlSuccess: sigControl !== undefined,
      verdict: (isIntegrityError && accountInfo === null) ? 'PASS' : 'FAIL',
      logs: logs
    };

    fs.writeFileSync(jsonReportPath, JSON.stringify(resultData, null, 2));

    // V3 - Structured Report
    let md = `# E01-T07-OQ10 — VaultId Hash Consistency Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Commit:** \`${commitHash}\`\n`;
    md += `**Environment:** \`${environment}\`\n`;
    md += `**Wallet:** \`${resultData.wallet}\`\n`;
    md += `**Vault ID:** \`${vaultId}\`\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Vérifier que le programme rejette strictement une instruction \`init_registry\` où le \`vaultIdHash\` fourni ne correspond pas au hash SHA-256 du \`vaultId\` en clair.\n\n`;

    md += `## 2. Portée\n`;
    md += `Instruction \`init_registry\` du programme \`sj_registry_program\`.\n\n`;

    md += `## 3. Préconditions\n`;
    md += `- Local validator actif sur le port 8899\n`;
    md += `- Programme déployé à l'adresse \`${programId.toBase58()}\`\n`;
    md += `- Wallet de test financé via airdrop\n\n`;

    md += `## 4. Données de test\n`;
    md += `- **VaultID Déterministe :** \`${vaultId}\`\n`;
    md += `- **Valid Hash :** \`${resultData.vaultIdHash_valid}\`\n`;
    md += `- **Forged Hash (Invalid) :** \`${resultData.vaultIdHash_invalid}\`\n\n`;

    md += `## 5. Procédure\n`;
    md += `1. Calculer le hash valide du VaultID.\n`;
    md += `2. Forger un hash invalide (hash d'une autre chaîne).\n`;
    md += `3. Appeler \`init_registry\` avec le VaultID clair et le hash FORGÉ.\n`;
    md += `4. Capturer l'erreur et vérifier le code \`6003\` (\`InvalidVaultIdHash\`).\n`;
    md += `5. Vérifier qu'aucun compte n'a été créé à l'adresse dérivée du hash invalide.\n`;
    md += `6. Effectuer un contrôle positif avec un hash valide pour confirmer le fonctionnement nominal.\n\n`;

    md += `## 6. Résultat attendu\n`;
    md += `L'instruction avec le hash forgé doit être rejetée avec l'erreur \`InvalidVaultIdHash\`. Aucun état on-chain ne doit être créé pour cette entrée.\n\n`;

    md += `## 7. Résultats observés\n\n`;
    md += `### 7.1 Test d'intégrité (Négatif)\n\n`;
    md += `- **Result:** ❌ Transaction rejetée par le programme\n`;
    md += `- **Error Code:** \`6003\` (InvalidVaultIdHash)\n`;
    
    if (logs.length > 0) {
      md += `<details><summary>Program Logs</summary>\n\n\`\`\`\n${logs.join('\n')}\n\`\`\`\n\n</details>\n\n`;
    }

    md += `### 7.2 Vérification d'état\n\n`;
    md += `- **Création de compte au PDA forgé :** 🚫 Aucun (Account is null)\n`;
    md += `- **Contrôle positif (hash valide) :** ✅ Succès\n\n`;
    
    md += `## FINAL VERDICT: **${resultData.verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ10] Qualification report archived at: ${mdReportPath}`);
  }, 60000);
});
