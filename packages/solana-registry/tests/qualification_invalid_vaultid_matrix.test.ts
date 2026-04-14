import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { 
  getProgram, 
  createInitRegistryInstruction, 
  getRegistryAddress
} from '../src/index';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * OQ-09 — Invalid VaultId Format Qualification Test
 * 
 * Target: init_registry instruction
 * Objective: Determine which vaultId formats are rejected by the program.
 */

interface TestCase {
  name: string;
  vaultId: string;
}

interface TestResult {
  name: string;
  vaultId: string;
  vaultIdHash: string;
  outcome: 'success' | 'rejected';
  errorName?: string;
  errorCode?: number;
  errorMessage?: string;
  logs?: string[];
  signature?: string;
  registryAddress?: string;
}

describe('OQ-09: Invalid VaultId Format Matrix', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const payer = Keypair.generate();
  const wallet = new anchor.Wallet(payer);
  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  
  const evidenceDir = path.join(__dirname, '../../../evidence/task-07');
  const jsonReportPath = path.join(evidenceDir, 'OQ-09-invalid-vaultid-results.json');
  const mdReportPath = path.join(evidenceDir, 'OQ-09-invalid-vaultid-results.md');

  const cases: TestCase[] = [
    { name: 'Uppercase', vaultId: 'Vault123' },
    { name: 'Special character', vaultId: 'vault@123' },
    { name: 'Length > 32', vaultId: 'vaultabcdefghijklmnopqrstuvwxyz12345' },
    { name: 'Spaces', vaultId: ' vault123 ' },
    { name: 'Dash (valid)', vaultId: 'vault-123' },
    { name: 'Underscore (valid)', vaultId: 'vault_123' },
    { name: 'Standard', vaultId: 'vault123' },
  ];

  beforeAll(async () => {
    const sig = await connection.requestAirdrop(payer.publicKey, 5 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  it('Executes the vaultId format matrix', async () => {
    const results: TestResult[] = [];
    const program = getProgram(connection, wallet as any, programId);

    for (const c of cases) {
      // Use a unique suffix to avoid PDA collisions if we run this multiple times on same validator
      // but keep the properties we want to test (uppercase, special, etc.)
      // Actually, for length/uppercase/etc, we want to test EXACTLY those strings.
      // Since we use a fresh wallet for the test run, collisions are less likely.
      const testVaultId = c.vaultId;
      const vaultIdHash = createHash('sha256').update(testVaultId.trim().toLowerCase()).digest('hex');
      const registryAddress = getRegistryAddress(payer.publicKey, testVaultId, programId).toBase58();

      const result: TestResult = {
        name: c.name,
        vaultId: testVaultId,
        vaultIdHash,
        outcome: 'success',
        registryAddress,
      };

      try {
        const ix = await createInitRegistryInstruction(program, payer.publicKey, testVaultId, 1, programId);
        const tx = new Transaction().add(ix);
        const sig = await program.provider.sendAndConfirm!(tx);
        result.outcome = 'success';
        result.signature = sig;
      } catch (err: any) {
        result.outcome = 'rejected';
        result.errorMessage = err.message || String(err);
        
        // Robust extraction of Anchor error
        if (err.logs) {
          result.logs = err.logs;
          const anchorError = err.logs.find((l: string) => l.includes('AnchorError'));
          if (anchorError) {
            const codeMatch = anchorError.match(/Error Code: (\w+)/);
            const numMatch = anchorError.match(/Error Number: (\d+)/);
            if (codeMatch) result.errorName = codeMatch[1];
            if (numMatch) result.errorCode = parseInt(numMatch[1], 10);
          }
        }
        
        // Fallback for hex codes in message (e.g. 0x1774)
        if (!result.errorCode && result.errorMessage?.includes('0x1774')) {
          result.errorCode = 6004;
          result.errorName = 'InvalidVaultIdFormat';
        }
      }

      results.push(result);
    }

    // 1. Generate JSON artifact
    fs.writeFileSync(jsonReportPath, JSON.stringify(results, null, 2));

    // 2. Generate Markdown report
    let md = `# OQ-09 — Invalid VaultId Format Qualification Report\n\n`;
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Wallet:** ${payer.publicKey.toBase58()}\n`;
    md += `**Program ID:** ${programId.toBase58()}\n\n`;
    
    md += `## Synthesis\n\n`;
    md += `| Case | vaultId | Outcome | Error Code | Error Name | Notes |\n`;
    md += `|------|---------|---------|------------|------------|-------|\n`;
    
    for (const r of results) {
      const outcomeLabel = r.outcome === 'success' ? '✅ Success' : '❌ Rejected';
      const errorCode = r.errorCode ?? '-';
      const errorName = r.errorName ?? '-';
      let notes = '';
      if (r.outcome === 'success') {
        notes = `Addr: \`${r.registryAddress?.slice(0, 8)}...\``;
      } else {
        notes = r.errorMessage?.split('\n')[0].slice(0, 50) + '...';
      }
      md += `| ${r.name} | \`${r.vaultId}\` | ${outcomeLabel} | ${errorCode} | ${errorName} | ${notes} |\n`;
    }
    
    md += `\n## Detailed Logs (Rejections)\n\n`;
    for (const r of results) {
      if (r.outcome === 'rejected') {
        md += `### Case: ${r.name} (\`${r.vaultId}\`)\n`;
        md += `- **Error Name:** ${r.errorName}\n`;
        md += `- **Error Code:** ${r.errorCode}\n`;
        md += `- **Message:** \`${r.errorMessage}\`\n`;
        if (r.logs) {
          md += `<details><summary>Program Logs</summary>\n\n\`\`\`\n${r.logs.join('\n')}\n\`\`\`\n\n</details>\n\n`;
        }
      }
    }

    fs.writeFileSync(mdReportPath, md);
    console.log(`Artifacts generated:\n- ${jsonReportPath}\n- ${mdReportPath}`);
  }, 60000);
});
