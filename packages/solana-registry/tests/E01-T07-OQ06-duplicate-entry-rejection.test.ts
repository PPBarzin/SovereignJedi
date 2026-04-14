import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { fetchRegistry, getRegistryAddress } from '../src/index';
import { registryService } from '../../../apps/web/src/lib/solana/RegistryService';
import * as fs from 'fs';
import * as path from 'path';

// Fix Vitest/Libsodium issues just in case
const sodium = require('libsodium-wrappers-sumo');
(globalThis as any).sodium = sodium;

/**
 * E1-T07-OQ06 — Duplicate Entry Rejection Qualification Test
 * 
 * Objective: 
 * Verify that the registry rejects duplicate manifestCid and preserves state.
 */

describe('E01-T07-OQ06: Duplicate Entry Rejection', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const payer = Keypair.generate();
  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");

  // Mock wallet compatible with both anchor and RegistryService (wallet-adapter like)
  const wallet = {
    publicKey: payer.publicKey,
    payer: payer,
    signTransaction: async (tx: any) => {
      tx.partialSign(payer);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach(tx => tx.partialSign(payer));
      return txs;
    },
    sendTransaction: async (tx: Transaction, conn: Connection) => {
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.partialSign(payer);
      return await conn.sendRawTransaction(tx.serialize());
    },
    connected: true,
  };

  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ06');
  const jsonReportPath = path.join(evidenceDir, 'E01-T07-OQ06-results.json');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ06-results.md');

  const vaultId = "oq06-vault-" + Math.random().toString(36).slice(2, 8);
  const testCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki";

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SJ_REGISTRY_PROGRAM_ID = programId.toBase58();
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = 'http://127.0.0.1:8899';
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = 'localnet';

    const sig = await connection.requestAirdrop(payer.publicKey, 5 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  it('Strictly rejects duplicate manifestCid and preserves state', async () => {
    console.log(`[E01-T07-OQ06] Starting test with wallet ${payer.publicKey.toBase58()} and vaultId ${vaultId}`);

    // 1. Initial append
    console.log(`[E01-T07-OQ06] Executing first append for CID: ${testCid}`);
    const sig1 = await registryService.publishManifest(wallet, vaultId, testCid, 1);
    expect(sig1).toBeDefined();
    console.log(`[E01-T07-OQ06] First append success. Sig: ${sig1}`);

    // 2. Read state before duplicate attempt
    const registryBefore: any = await fetchRegistry(connection, payer.publicKey, vaultId, programId);
    expect(registryBefore).not.toBeNull();
    expect(registryBefore.entries.length).toBe(1);
    const updatedAtBefore = registryBefore.updatedAt.toString();
    const snapshotBefore = JSON.stringify(registryBefore.entries, null, 2);

    // 3. Attempt duplicate append
    console.log(`[E01-T07-OQ06] Attempting duplicate append for SAME CID...`);
    let capturedError: any = null;
    try {
      await registryService.publishManifest(wallet, vaultId, testCid, 1);
      expect.fail("Should have thrown DuplicateEntry error");
    } catch (err: any) {
      capturedError = err;
      console.log(`[E01-T07-OQ06] Captured expected error.`);
    }

    // Verify error code (0x1772 = 6002 = DuplicateEntry)
    const errStr = String(capturedError);
    const logs = capturedError?.logs || (capturedError?.transactionLogs ? capturedError.transactionLogs : []);
    const isDuplicateError = errStr.includes('0x1772') || errStr.includes('6002') || errStr.includes('DuplicateEntry') || logs.some((l: string) => l.includes('DuplicateEntry'));
    
    expect(isDuplicateError).toBe(true);

    // 4. Read state after failure
    const registryAfter: any = await fetchRegistry(connection, payer.publicKey, vaultId, programId);
    expect(registryAfter).not.toBeNull();
    expect(registryAfter.entries.length).toBe(1);
    const updatedAtAfter = registryAfter.updatedAt.toString();
    const snapshotAfter = JSON.stringify(registryAfter.entries, null, 2);

    // 5. Comparison
    const entriesIdentical = snapshotBefore === snapshotAfter;
    const updatedAtIdentical = updatedAtBefore === updatedAtAfter;
    const totalIdentical = entriesIdentical && updatedAtIdentical;

    expect(totalIdentical).toBe(true);
    console.log(`[E01-T07-OQ06] Integrity verified: state is strictly identical.`);

    // 6. Generate evidence
    const resultData = {
      testId: 'E01-T07-OQ06',
      timestamp: new Date().toISOString(),
      wallet: payer.publicKey.toBase58(),
      vaultId,
      programId: programId.toBase58(),
      registryAddress: getRegistryAddress(payer.publicKey, vaultId, programId).toBase58(),
      firstAppendSignature: sig1,
      duplicateAttemptError: {
        message: errStr,
        logs: logs
      },
      verdict: totalIdentical ? 'PASS' : 'FAIL',
      data: {
        entriesCount: registryAfter.entries.length,
        updatedAt: updatedAtAfter,
        manifestCid: registryAfter.entries[0].manifestCid
      }
    };

    fs.writeFileSync(jsonReportPath, JSON.stringify(resultData, null, 2));

    let md = `# E01-T07-OQ06 — Duplicate Entry Rejection Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Wallet:** \`${resultData.wallet}\`\n`;
    md += `**Vault ID:** \`${resultData.vaultId}\`\n`;
    md += `**Registry Address:** \`${resultData.registryAddress}\`\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Vérifier que le registre rejette les \`manifestCid\` dupliqués et préserve l'état.\n\n`;

    md += `## 2. Successful First Append\n\n`;
    md += `- CID: \`${testCid}\`\n`;
    md += `- Transaction: [\`${sig1.slice(0, 16)}...\`](https://explorer.solana.com/tx/${sig1}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899)\n`;
    md += `- Status: ✅ Confirmé\n\n`;
    
    md += `## 3. Duplicate Attempt Rejection\n\n`;
    md += `- Tentative de publication du même CID une seconde fois.\n`;
    md += `- **Résultat:** ❌ Rejeté par le programme\n`;
    md += `- **Erreur attendue:** \`DuplicateEntry\` (0x1772 / 6002)\n`;
    md += `- **Message d'erreur réel:** \`${errStr.split('\n')[0]}\`\n`;
    
    if (logs.length > 0) {
      md += `<details><summary>Logs du programme</summary>\n\n\`\`\`\n${logs.join('\n')}\n\`\`\`\n\n</details>\n\n`;
    }
    
    md += `## 4. On-Chain State Integrity\n\n`;
    md += `| Métrique | Avant Tentative | Après Échec | Match |\n`;
    md += `|--------|----------------|---------------|-------|\n`;
    md += `| Entries Count | 1 | 1 | ✅ |\n`;
    md += `| Head CID | \`${testCid.slice(0, 12)}...\` | \`${testCid.slice(0, 12)}...\` | ✅ |\n`;
    md += `| Last Updated | \`${updatedAtBefore}\` | \`${updatedAtAfter}\` | ✅ |\n\n`;
    
    md += `- **Vérification d'intégrité:** L'état du registre est resté strictement inchangé après la transaction rejetée : **✅ PASS**\n\n`;
    
    md += `### FINAL VERDICT: **${resultData.verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ06] Qualification report archived at: ${mdReportPath}`);
    
    expect(resultData.verdict).toBe('PASS');
  }, 60000);
});
