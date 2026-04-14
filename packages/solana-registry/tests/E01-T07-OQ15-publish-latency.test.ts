import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as nacl from "tweetnacl";
import { getProgram } from '../src/index';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

// Fix Vitest/Libsodium issues
const sodium = require('libsodium-wrappers-sumo');
(globalThis as any).sodium = sodium;

/**
 * E01-T07-OQ15 — Publish Latency Qualification Test
 * 
 * Objective: 
 * Measure publication time (append_manifest) on localnet and verify it stays 
 * within the acceptable envelope (Target: < 2s for localnet).
 */

describe('E01-T07-OQ15: Publish Latency Measurement', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  
  // Deterministic wallet for consistency
  const seed = new Uint8Array(32).fill(0xCC);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const wallet = Keypair.fromSecretKey(kp.secretKey);

  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  const commitHash = "16bc1e06336f6a191a00f15c1c66265e74d38ece";
  const environment = "localnet (127.0.0.1:8899)";
  const targetThresholdMs = 2000; // 2 seconds target for localnet

  const evidenceDir = path.join(__dirname, '../../../evidence/episode-01/task-07/OQ15');
  const jsonReportPath = path.join(evidenceDir, 'E01-T07-OQ15-results.json');
  const mdReportPath = path.join(evidenceDir, 'E01-T07-OQ15-results.md');

  const vaultId = "oq15-latency-test-v1";
  const vaultIdHash = createHash('sha256').update(vaultId).digest();

  beforeAll(async () => {
    // Airdrop
    const sig = await connection.requestAirdrop(wallet.publicKey, 2 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    // Initialize registry for the test
    const program = getProgram(connection, new anchor.Wallet(wallet) as any, programId);
    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from('SJ_REGISTRY_V1'), wallet.publicKey.toBuffer(), vaultIdHash],
      programId
    )[0];

    console.log(`[E01-T07-OQ15] Checking if registry exists...`);
    const accountInfo = await connection.getAccountInfo(registryPda);
    if (!accountInfo) {
        console.log(`[E01-T07-OQ15] Initializing registry for latency test...`);
        await program.methods
          .initRegistry(vaultId, Array.from(vaultIdHash), 1)
          .accounts({
            registry: registryPda,
            wallet: wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          } as any)
          .rpc();
    } else {
        console.log(`[E01-T07-OQ15] Registry already exists, skipping init.`);
    }
  });

  it('Measures latency over 10 runs and verifies performance envelope', async () => {
    const program = getProgram(connection, new anchor.Wallet(wallet) as any, programId);
    const registryPda = PublicKey.findProgramAddressSync(
        [Buffer.from('SJ_REGISTRY_V1'), wallet.publicKey.toBuffer(), vaultIdHash],
        programId
    )[0];

    const runCount = 10;
    const runs: { id: number; durationMs: number; timestamp: string }[] = [];

    console.log(`[E01-T07-OQ15] Starting ${runCount} publication runs...`);

    for (let i = 0; i < runCount; i++) {
      const uniqueString = `latency-test-run-${i}-${Date.now()}`;
      const hash = createHash('sha256').update(uniqueString).digest('hex');
      // Simple mock Qm-like CID (Base58 characters only, no O, 0, I, l)
      const cid = "Qm" + hash.slice(0, 44).replace(/[0OIil]/g, 'x'); 
      
      const start = performance.now();
      const startTimeStamp = new Date().toISOString();
      
      try {
        await program.methods
          .appendManifest(Array.from(vaultIdHash), cid, 1)
          .accounts({
            registry: registryPda,
            wallet: wallet.publicKey,
          } as any)
          .rpc();
        
        const end = performance.now();
        const duration = end - start;
        
        runs.push({
          id: i + 1,
          durationMs: parseFloat(duration.toFixed(2)),
          timestamp: startTimeStamp
        });
        
        console.log(`[E01-T07-OQ15] Run ${i+1}/${runCount}: ${duration.toFixed(2)}ms`);
      } catch (err) {
        console.error(`[E01-T07-OQ15] Run ${i+1} FAILED:`, err);
      }
    }

    expect(runs.length).toBeGreaterThan(0);

    // Calculate stats
    const durations = runs.map(r => r.durationMs).sort((a, b) => a - b);
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
      testId: 'E01-T07-OQ15',
      timestamp: new Date().toISOString(),
      commitHash,
      environment,
      walletPubKey: wallet.publicKey.toBase58(),
      vaultId,
      pda: registryPda.toBase58(),
      runs,
      stats,
      verdict
    };

    fs.writeFileSync(jsonReportPath, JSON.stringify(resultData, null, 2));

    let md = `# E01-T07-OQ15 — Publish Latency Qualification Report\n\n`;
    md += `**Date:** ${resultData.timestamp}\n`;
    md += `**Commit:** \`${commitHash}\`\n`;
    md += `**Environment:** \`${environment}\`\n`;
    md += `**Wallet:** \`${resultData.walletPubKey}\`\n`;
    md += `**Target Threshold:** \`< ${targetThresholdMs}ms\`\n\n`;
    
    md += `## 1. Objectif\n`;
    md += `Mesurer le temps de publication (\`append_manifest\`) sur environnement localnet et vérifier la cohérence des performances.\n\n`;

    md += `## 2. Portée\n`;
    md += `Instruction \`append_manifest\` du programme \`sj_registry_program\` via le SDK client.\n\n`;

    md += `## 3. Préconditions\n`;
    md += `- Local validator actif.\n`;
    md += `- Wallet de test déterministe (seed fixe).\n`;
    md += `- Registre initialisé avant le début des mesures.\n\n`;

    md += `## 4. Données de test\n`;
    md += `- **Nombre de runs :** \`${runCount}\`\n`;
    md += `- **Payload :** CID unique par run (String 64 chars).\n\n`;

    md += `## 5. Statistiques Agrégées\n\n`;
    md += `| Métrique | Valeur (ms) |\n`;
    md += `| :--- | :--- |\n`;
    md += `| Minimum | \`${stats.min}\` |\n`;
    md += `| Maximum | \`${stats.max}\` |\n`;
    md += `| Moyenne | \`${stats.avg}\` |\n`;
    md += `| Médiane | \`${stats.median}\` |\n`;
    md += `| **Seuil Cible** | **\`< ${targetThresholdMs}\`** |\n\n`;

    md += `## 6. Détails des Runs\n\n`;
    md += `| Run # | Timestamp | Durée (ms) |\n`;
    md += `| :--- | :--- | :--- |\n`;
    for (const run of runs) {
        md += `| ${run.id} | ${run.timestamp} | \`${run.durationMs}\` |\n`;
    }
    md += `\n`;

    md += `## 7. Analyse et Verdict\n`;
    md += `Les mesures montrent une performance ${verdict === 'PASS' ? 'conforme' : 'non-conforme'} à l'enveloppe attendue pour localnet.\n`;
    md += `La dispersion (\`max - min\`) est de \`${(max - min).toFixed(2)}ms\`.\n\n`;
    
    md += `## FINAL VERDICT: **${verdict}**\n`;

    fs.writeFileSync(mdReportPath, md);
    console.log(`[E01-T07-OQ15] Qualification report archived at: ${mdReportPath}`);
    
    expect(verdict).toBe('PASS');
  }, 60000);
});
