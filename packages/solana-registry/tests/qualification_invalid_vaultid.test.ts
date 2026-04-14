import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { 
  getRegistryAddress, 
  getProgram, 
  fetchRegistry, 
  createInitRegistryInstruction, 
  createAppendManifestInstruction,
} from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

describe('Qualification: MAX_ENTRIES Invariant', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const payer = Keypair.generate();
  const wallet = new anchor.Wallet(payer);
  const programId = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");
  
  const evidenceDir = path.join(__dirname, '../../../evidence/task-07');
  const reportPath = path.join(evidenceDir, 'GQ-04-max-entries.md');

  beforeAll(async () => {
    const sig = await connection.requestAirdrop(payer.publicKey, 10 * 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
  });

  const sendTx = async (ix: any) => {
    const tx = new Transaction().add(ix);
    const program = getProgram(connection, wallet as any, programId);
    return await program.provider.sendAndConfirm!(tx);
  };

  it('Strictly enforces MAX_ENTRIES = 32 and preserves data', async () => {
    const program = getProgram(connection, wallet as any, programId);
    //const vaultId = "qualif-max-" + Math.random().toString(36).slice(2, 10);
    const vaultId = "Vault123"
    const schemaVersion = 1;
    
    let report = `# Qualification Report - MAX_ENTRIES Invariant\n\n`;
    report += `**Date:** ${new Date().toISOString()}\n`;
    report += `**Wallet:** ${payer.publicKey.toBase58()}\n`;
    report += `**Vault ID:** ${vaultId}\n`;
    report += `**Program ID:** ${programId.toBase58()}\n\n`;

    // 1. Initial State
    report += `## 1. Initial State\n`;
    await sendTx(await createInitRegistryInstruction(program, payer.publicKey, vaultId, schemaVersion, programId));
    const initialRegistry = await fetchRegistry(connection, payer.publicKey, vaultId, programId);
    expect(initialRegistry?.entries.length).toBe(0);
    report += `- Registry initialized successfully.\n`;
    report += `- Initial entries count: ${initialRegistry?.entries.length}\n\n`;

    // 2. Perform 32 successful appends
    report += `## 2. Successful Appends (1 to 32)\n`;
    report += `| Index | CID | Transaction Signature |\n`;
    report += `|-------|-----|-----------------------|\n`;
    
    const testData: string[] = [];
    const signatures: string[] = [];

    const base32Chars = "abcdefghijklmnopqrstuvwxyz234567";
    for (let i = 1; i <= 32; i++) {
      const cid = `b${base32Chars[i % 32].repeat(32)}${base32Chars[(i >> 5) % 32]}${base32Chars[i % 32]}`;
      testData.push(cid);
      
      const sig = await sendTx(await createAppendManifestInstruction(program, payer.publicKey, vaultId, cid, schemaVersion, programId));
      signatures.push(sig);
      report += `| ${i} | ${cid} | ${sig} |\n`;
    }
    report += `\n`;

    // 3. Verify Registry after 32 appends
    report += `## 3. Registry State after 32 Appends\n`;
    const registryAfter32 = await fetchRegistry(connection, payer.publicKey, vaultId, programId);
    expect(registryAfter32?.entries.length).toBe(32);
    report += `- Final entries count: ${registryAfter32?.entries.length}\n`;
    
    report += `### Data Verification\n`;
    report += `| Index | Expected CID | Actual CID | Match |\n`;
    report += `|-------|--------------|------------|-------|\n`;
    for (let i = 0; i < 32; i++) {
      const match = registryAfter32?.entries[i].manifestCid === testData[i];
      expect(match).toBe(true);
      report += `| ${i+1} | ${testData[i]} | ${registryAfter32?.entries[i].manifestCid} | ${match ? '✅' : '❌'} |\n`;
    }
    report += `\n`;

    const snapshot32 = JSON.stringify(registryAfter32?.entries, null, 2);
    fs.writeFileSync(path.join(evidenceDir, 'GQ-04-dump-32.json'), snapshot32);

    // 4. Attempt 33rd append
    report += `## 4. 33rd Append Attempt (Expect Failure)\n`;
    const cid33 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki";
    try {
      await sendTx(await createAppendManifestInstruction(program, payer.publicKey, vaultId, cid33, schemaVersion, programId));
      expect.fail("Should have failed RegistryFull");
    } catch (e: any) {
      const errorMsg = e.message || String(e);
      expect(errorMsg).toContain("RegistryFull");
      report += `- CID 33: ${cid33}\n`;
      report += `- **Result:** Failed as expected.\n`;
      report += `- **Error Message:** \`${errorMsg}\`\n\n`;
    }

    // 5. Final Verification
    report += `## 5. Final Registry Verification\n`;
    const finalRegistry = await fetchRegistry(connection, payer.publicKey, vaultId, programId);
    expect(finalRegistry?.entries.length).toBe(32);
    report += `- Final entries count: ${finalRegistry?.entries.length}\n`;
    
    const snapshotFinal = JSON.stringify(finalRegistry?.entries, null, 2);
    fs.writeFileSync(path.join(evidenceDir, 'GQ-04-dump-final.json'), snapshotFinal);
    const strictlyIdentical = snapshot32 === snapshotFinal;
    expect(strictlyIdentical).toBe(true);
    
    report += `- **Integrity Check:** Existing 32 entries are strictly identical to the state before the failed 33rd append: ${strictlyIdentical ? '✅' : '❌'}\n\n`;

    fs.writeFileSync(reportPath, report);
    console.log(`Qualification report archived at: ${reportPath}`);
  }, 120000);
});
