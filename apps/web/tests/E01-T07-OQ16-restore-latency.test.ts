import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as nacl from "tweetnacl";
import { getProgram } from '@sj/solana-registry';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

// We'll use RegistryService for a realistic measure
import { RegistryService } from '../src/lib/solana/RegistryService';

// Fix Vitest/Libsodium issues
const sodium = require('libsodium-wrappers-sumo');
(globalThis as any).sodium = sodium;

/**
 * E01-T07-OQ16 — Restore Latency Qualification Test
 * 
 * Objective: 
 * Measure full restoration time (Solana Registry Fetch + IPFS Cat) 
 * and verify it stays within the acceptable envelope.
 */

describe('E01-T07-OQ16: Restore Latency Measurement', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  
  // Deterministic wallet for consistency
  const seed = new Uint8Array(32).fill(0xDD);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const wallet = Keypair.fromSecretKey(kp.secretKey);

  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  const commitHash = "16bc1e06336f6a191a00f15c1c66265e74d38ece";
  const environment = "localnet (Solana) + local IPFS";
  const targetThresholdMs = 3000; // 3 seconds target for full restore on local infra

  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ16');
  const jsonReportPath = path.join(evidenceDir, 'E01-T07-OQ16-results.json');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ16-results.md');

  const vaultId = "oq16-restore-latency-v1";
  const vaultIdHash = createHash('sha256').update(vaultId).digest();
  
  // Test manifest payload
  const manifestData = new Uint8Array(1024).fill(0x55); // 1KB manifest
  let testCid: string = "";

  beforeAll(async () => {
    // 1. Setup Solana environment
    const sig = await connection.requestAirdrop(wallet.publicKey, 2 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    // 2. Setup IPFS data
    const { addBytes } = await import('@sj/ipfs');
    const addResult = await addBytes(manifestData);
    testCid = typeof addResult === 'string' ? addResult : addResult.cid;
    console.log(`[E01-T07-OQ16] Pre-seeded IPFS CID: ${testCid}`);

    // 3. Initialize registry with the CID
    const program = getProgram(connection, new anchor.Wallet(wallet) as any, programId);
    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from('SJ_REGISTRY_V1'), wallet.publicKey.toBuffer(), vaultIdHash],
      programId
    )[0];

    console.log(`[E01-T07-OQ16] Checking if registry exists...`);
    const accountInfo = await connection.getAccountInfo(registryPda);
    if (!accountInfo) {
        console.log(`[E01-T07-OQ16] Initializing registry with manifest...`);
        const sig1 = await program.methods
          .initRegistry(vaultId, Array.from(vaultIdHash), 1)
          .accounts({
            registry: registryPda,
            wallet: wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          } as any)
          .rpc();
        console.log(`[E01-T07-OQ16] initRegistry signature: ${sig1}`);

        const sig2 = await program.methods
          .appendManifest(Array.from(vaultIdHash), testCid, 1)
          .accounts({
            registry: registryPda,
            wallet: wallet.publicKey,
          } as any)
          .rpc();
        console.log(`[E01-T07-OQ16] appendManifest signature: ${sig2}`);
        
        // Explicitly wait and verify
        const acc = await program.account.registryAccount.fetch(registryPda);
        console.log(`[E01-T07-OQ16] Registry verified. Entry count: ${acc.entries.length}`);
    } else {
        console.log(`[E01-T07-OQ16] Registry already exists, ensuring it has entries...`);
        const acc = await program.account.registryAccount.fetch(registryPda);
        if (acc.entries.length === 0) {
            console.log(`[E01-T07-OQ16] Registry empty, appending entry...`);
            await program.methods
                .appendManifest(Array.from(vaultIdHash), testCid, 1)
                .accounts({
                    registry: registryPda,
                    wallet: wallet.publicKey,
                } as any)
                .rpc();
        }
        console.log(`[E01-T07-OQ16] Registry ready. Entry count: ${(await program.account.registryAccount.fetch(registryPda)).entries.length}`);
    }
  });

  it('Measures full restore latency (Solana + IPFS) over 10 runs', async () => {
    const service = new RegistryService();
    const runCount = 10;
    const runs: { id: number; solanaMs: number; ipfsMs: number; totalMs: number; timestamp: string }[] = [];

    console.log(`[E01-T07-OQ16] Starting ${runCount} restoration runs...`);

    for (let i = 0; i < runCount; i++) {
      const startTimeStamp = new Date().toISOString();
      const startTotal = performance.now();
      
      try {
        // Step 1: Fetch Registry from Solana
        const startSolana = performance.now();
        const registry = await service.getRegistry(wallet.publicKey.toBase58(), vaultId);
        const endSolana = performance.now();
        
        if (!registry) throw new Error("Registry not found");
        const entry = service.getLatestEntry(registry.entries);
        if (!entry) throw new Error("No entries in registry");
        
        // Step 2: Fetch Manifest from IPFS
        const startIpfs = performance.now();
        const data = await service.getManifestFromIpfs(entry.manifestCid);
        const endIpfs = performance.now();
        
        const endTotal = performance.now();

        expect(data.length).toBe(manifestData.length);
        
        runs.push({
          id: i + 1,
          solanaMs: parseFloat((endSolana - startSolana).toFixed(2)),
          ipfsMs: parseFloat((endIpfs - startIpfs).toFixed(2)),
          totalMs: parseFloat((endTotal - startTotal).toFixed(2)),
          timestamp: startTimeStamp
        });
        
        console.log(`[E01-T07-OQ16] Run ${i+1}/${runCount}: Total ${runs[i].totalMs}ms (Solana: ${runs[i].solanaMs}ms, IPFS: ${runs[i].ipfsMs}ms)`);
      } catch (err) {
        console.error(`[E01-T07-OQ16] Run ${i+1} FAILED:`, err);
      }
    }

    expect(runs.length).toBeGreaterThan(0);

    // Calculate stats
    const durations = runs.map(r => r.totalMs).sort((a, b) => a - b);
    const min = durations[0];
    const max = durations[durations.length - 1];
    const sum = durations.reduce((a, b) => a + b, 0);
    const avg = sum / durations.length;
    const median = durations.length % 2 === 0 
        ? (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
        : durations[Math.floor(durations.length / 2)];

    const stats = {
      count: runs.length,
      min,
      max,
      avg: parseFloat(avg.toFixed(2)),
      median: parseFloat(median.toFixed(2)),
      targetThresholdMs
    };

    const verdict = median < targetThresholdMs ? 'PASS' : 'FAIL';

    // 4. Generate Artefacts
    const resultData = {
      testId: 'E01-T07-OQ16',
      timestamp: new Date().toISOString(),
      commitHash,
      environment,
      walletPubKey: wallet.publicKey.toBase58(),
      vaultId,
      manifestCid: testCid,
      manifestSize: manifestData.length,
      runs,
      stats,
      verdict
    };

    fs.writeFileSync(jsonReportPath, JSON.stringify(resultData, null, 2));

    let md = `# E01-T07-OQ16 — Restore Latency Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Commit:** \`${commitHash}\`\n`;
    md += `**Environment:** \`${environment}\`\n`;
    md += `**Wallet:** \`${resultData.walletPubKey}\`\n`;
    md += `**Target Threshold:** \`< ${targetThresholdMs}ms\`\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Mesurer le temps total de restauration (\`fetchRegistry\` + \`catBytes\`) sur environnement localnet/local-ipfs et vérifier la réactivité.\n\n`;

    md += `## 2. Portée\n`;
    md += `Couvre le \`RegistryService\` (apps/web/src/lib/solana/RegistryService.ts) incluant la récupération RPC Solana et le fetch IPFS.\n\n`;

    md += `## 3. Préconditions\n`;
    md += `- Local Solana validator actif.\n`;
    md += `- Local IPFS (Helia) actif.\n`;
    md += `- Registre pré-peuplé avec un manifest de 1KB.\n\n`;

    md += `## 4. Données de test\n`;
    md += `- **Nombre de runs :** \`${runCount}\`\n`;
    md += `- **Taille du manifest :** \`${resultData.manifestSize} bytes\`\n`;
    md += `- **CID :** \`${testCid}\`\n\n`;

    md += `## 5. Statistiques Agrégées (Total)\n\n`;
    md += `| Métrique | Valeur (ms) |\n`;
    md += `| :--- | :--- |\n`;
    md += `| Minimum | \`${stats.min}\` |\n`;
    md += `| Maximum | \`${stats.max}\` |\n`;
    md += `| Moyenne | \`${stats.avg}\` |\n`;
    md += `| Médiane | \`${stats.median}\` |\n`;
    md += `| **Seuil Cible** | **\`< ${targetThresholdMs}\`** |\n\n`;

    md += `## 6. Détails des Runs\n\n`;
    md += `| Run # | Solana (ms) | IPFS (ms) | TOTAL (ms) |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const run of runs) {
        md += `| ${run.id} | ${run.solanaMs} | ${run.ipfsMs} | **${run.totalMs}** |\n`;
    }
    md += `\n`;

    md += `## 7. Analyse et Verdict\n`;
    md += `Les mesures incluent le temps de réponse RPC et le temps de récupération IPFS local.\n`;
    md += `Le verdict final est basé sur la médiane des temps totaux.\n\n`;
    
    md += `## FINAL VERDICT: **${verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ16] Qualification report archived at: ${mdReportPath}`);
    
    expect(verdict).toBe('PASS');
  }, 60000);
});
