import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getProgram, fetchRegistry } from '../src/index';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Fix Vitest/Libsodium issues
const sodium = require('libsodium-wrappers-sumo');
(globalThis as any).sodium = sodium;

/**
 * E01-T07-OQ11 — RPC Down Qualification Test
 * 
 * Objective: 
 * Verify that publication and read operations fail gracefully when RPC is down.
 */

describe('E01-T07-OQ11: RPC Down Robustness', () => {
  const commitHash = "16bc1e06336f6a191a00f15c1c66265e74d38ece";
  const environment = "localnet (Down simulation)";
  const invalidRpcUrl = "http://127.0.0.1:1"; // Closed port
  
  const payer = Keypair.generate();
  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  
  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ11');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ11-results.md');
  const jsonReportPathActual = path.join(evidenceDir, 'E01-T07-OQ11-results.json');

  const vaultId = "oq11-rpc-down-test-v1";

  beforeAll(async () => {
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  it('Fails properly on publication and discovery when RPC is unavailable', async () => {
    console.log(`[E01-T07-OQ11] Starting RPC Down test with URL: ${invalidRpcUrl}`);

    const invalidConnection = new Connection(invalidRpcUrl, 'confirmed');
    const invalidWallet = new anchor.Wallet(payer);
    const program = getProgram(invalidConnection, invalidWallet as any, programId);
    const vaultIdHash = createHash('sha256').update(vaultId).digest();

    // 1. Attempt Publication (Direct call to force network interaction)
    console.log(`[E01-T07-OQ11] Step 1: Attempting publication (initRegistry)...`);
    let publishError: any = null;
    let publishSignature: string | null = null;

    try {
      publishSignature = await program.methods
        .initRegistry(vaultId, Array.from(vaultIdHash), 1)
        .accounts({
          registry: PublicKey.findProgramAddressSync(
            [Buffer.from('SJ_REGISTRY_V1'), payer.publicKey.toBuffer(), vaultIdHash],
            programId
          )[0],
          wallet: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err: any) {
      publishError = err;
      console.log(`[E01-T07-OQ11] Publication failed as expected: ${err.message || err}`);
    }

    // Assertions for Publication
    expect(publishSignature).toBeNull();
    expect(publishError).toBeDefined();
    // V1 - Must be a real network error (fetch failed or ECONNREFUSED)
    const isNetworkErrorPublish = String(publishError).includes('fetch failed') || 
                                  String(publishError).includes('ECONNREFUSED');
    expect(isNetworkErrorPublish).toBe(true);

    // 2. Attempt Read (Discovery)
    console.log(`[E01-T07-OQ11] Step 2: Attempting registry fetch...`);
    let readError: any = null;
    let readResult: any = null;

    try {
      readResult = await fetchRegistry(invalidConnection, payer.publicKey, vaultId, programId);
    } catch (err: any) {
      readError = err;
      console.log(`[E01-T07-OQ11] Read failed as expected: ${err.message || err}`);
    }

    // Assertions for Read
    expect(readResult).toBeNull();
    expect(readError).toBeDefined();
    const isNetworkErrorRead = String(readError).includes('fetch failed') || 
                               String(readError).includes('ECONNREFUSED');
    expect(isNetworkErrorRead).toBe(true);

    // 3. Generate Evidence
    const resultData = {
      testId: 'E01-T07-OQ11',
      timestamp: new Date().toISOString(),
      commitHash,
      environment,
      invalidRpcUrl,
      wallet: payer.publicKey.toBase58(),
      vaultId,
      publish: {
        method: "init_registry (Direct call)",
        signatureProduced: publishSignature,
        errorCaptured: String(publishError).split('\n')[0]
      },
      read: {
        resultProduced: readResult,
        errorCaptured: String(readError).split('\n')[0]
      },
      verdict: (isNetworkErrorPublish && isNetworkErrorRead) ? 'PASS' : 'FAIL'
    };

    fs.writeFileSync(jsonReportPathActual, JSON.stringify(resultData, null, 2));

    let md = `# E01-T07-OQ11 — RPC Down Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Commit:** \`${commitHash}\`\n`;
    md += `**Environment:** \`${environment}\`\n`;
    md += `**Wallet:** \`${resultData.wallet}\`\n`;
    md += `**Target RPC:** \`${invalidRpcUrl}\` (Délivrément invalide)\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Vérifier qu'en cas d'indisponibilité RPC, les opérations de publication et de lecture échouent proprement sans corrompre l'état local ni produire un faux succès.\n\n`;

    md += `## 2. Portée\n`;
    md += `- Instruction \`init_registry\` (Publication)\n`;
    md += `- Helper \`fetchRegistry\` (Lecture)\n\n`;

    md += `## 3. Préconditions\n`;
    md += `- Port \`1\` sur \`localhost\` fermé (standard pour simuler un service injoignable)\n`;
    md += `- Injection de l'URL \`${invalidRpcUrl}\` via \`Connection\` explicite\n\n`;

    md += `## 4. Données de test\n`;
    md += `- **VaultID :** \`${vaultId}\`\n`;
    md += `- **VaultID Hash :** \`${vaultIdHash.toString('hex')}\`\n\n`;

    md += `## 5. Procédure\n`;
    md += `1. Configurer une \`Connection\` Solana sur un port fermé (\`${invalidRpcUrl}\`).\n`;
    md += `2. Tenter d'initialiser un registre via \`program.methods.initRegistry\`. Cette opération force un appel réseau (\`getLatestBlockhash\`) qui doit échouer.\n`;
    md += `3. Vérifier que l'appel lève une exception réseau (\`fetch failed\`) et ne retourne aucune signature.\n`;
    md += `4. Tenter une lecture de registre via \`fetchRegistry\` sur la même connexion.\n`;
    md += `5. Vérifier que l'appel lève une exception réseau et ne retourne aucune donnée.\n\n`;

    md += `## 6. Résultat attendu\n`;
    md += `Les deux opérations doivent échouer avec une erreur de type \`fetch failed\` ou \`ECONNREFUSED\`. Aucun succès ne doit être signalé. L'invariant d'intégrité face aux pannes d'infrastructure est ainsi qualifié.\n\n`;

    md += `## 7. Résultats observés\n\n`;
    md += `### 7.1 Échec de Publication (Instruction Write)\n\n`;
    md += `- **Signature retournée :** \`${publishSignature || 'null'}\` (Attendu: null)\n`;
    md += `- **Erreur capturée :** \`${resultData.publish.errorCaptured}\` ✅\n\n`;

    md += `### 7.2 Échec de Lecture (Instruction Read)\n\n`;
    md += `- **Données retournées :** \`${readResult || 'null'}\` (Attendu: null)\n`;
    md += `- **Erreur capturée :** \`${resultData.read.errorCaptured}\` ✅\n\n`;
    
    md += `## FINAL VERDICT: **${resultData.verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ11] Qualification report archived at: ${mdReportPath}`);
    
    expect(resultData.verdict).toBe('PASS');
  }, 30000);
});
