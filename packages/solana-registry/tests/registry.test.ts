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
import { registryService } from '../../../apps/web/src/lib/solana/RegistryService';
import BN from 'bn.js';

describe('Solana Registry Hostile E2E (STEEL)', () => {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const payer = Keypair.generate();
  const wallet = new anchor.Wallet(payer);
  
  beforeAll(async () => {
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * 1000000000);
    await connection.confirmTransaction(sig);
  });

  const sendTx = async (ix: any) => {
    const tx = new Transaction().add(ix);
    return await getProgram(connection, wallet as any).provider.sendAndConfirm!(tx);
  };

  it('C1: should fail RegistryFull after 32 entries', async () => {
    const program = getProgram(connection, wallet as any);
    const vId = "full-test-" + Math.random().toString(36).slice(2);
    
    await sendTx(await createInitRegistryInstruction(program, payer.publicKey, vId));
    
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    for (let i = 0; i < 32; i++) {
      const uniquePart = Array.from({length: 31}, (_, j) => alphabet[(i + j) % 32]).join('');
      const cid = `b${uniquePart}`; 
      await sendTx(await createAppendManifestInstruction(program, payer.publicKey, vId, cid));
    }
    
    const registry = await fetchRegistry(connection, payer.publicKey, vId);
    expect(registry?.entries.length).toBe(32);

    try {
      await sendTx(await createAppendManifestInstruction(program, payer.publicKey, vId, "baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaff"));
      expect.fail("Should have failed RegistryFull");
    } catch (e: any) {
      expect(e.message).toContain("RegistryFull");
    }
  }, 60000);

  it('C2: should fail for invalid VaultId formats', async () => {
    const program = getProgram(connection, wallet as any);
    const cases = ["LOCAL DEFAULT", "vault/../evil", "a".repeat(33), ""];

    for (const badId of cases) {
      try {
        await sendTx(await createInitRegistryInstruction(program, payer.publicKey, badId));
        expect.fail(`Should have failed for ${badId}`);
      } catch (e: any) {
        expect(e.message).toContain("InvalidVaultIdFormat");
      }
    }
  });

  it('C3: should fail on VaultIdHash mismatch (ConstraintSeeds)', async () => {
    const program = getProgram(connection, wallet as any);
    const vId = "hash-mismatch-barrier";
    const sabotagedHash = new Uint8Array(32).fill(0xee); 
    
    // Spec: mismatch vaultId/hash MUST be blocked by the PDA barrier.
    // We use the CORRECT PDA address (derived from real vaultId hash)
    // but pass a WRONG hash as argument. Anchor seeds constraint will reject it.
    const pda = await getRegistryAddress(payer.publicKey, vId); 
    
    const ix = await program.methods
      .initRegistry(vId, sabotagedHash as any, 1)
      .accounts({
        registry: pda,
        wallet: payer.publicKey,
      } as any)
      .instruction();

    try {
      await sendTx(ix);
      expect.fail("Should have failed ConstraintSeeds");
    } catch (e: any) {
      expect(e.message).toContain("ConstraintSeeds");
    }
  });

  it('C4: should validate CIDv1 and CIDv0 correctly (InvalidCidFormat)', async () => {
    const program = getProgram(connection, wallet as any);
    const vId = "cid-validation-" + Math.random().toString(36).slice(2);
    await sendTx(await createInitRegistryInstruction(program, payer.publicKey, vId));

    const cidV1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3hlgtv7p7n624ki";
    await sendTx(await createAppendManifestInstruction(program, payer.publicKey, vId, cidV1));

    const badCids = ["bafybei_INVALID", "Qminvalid0OIl", "not-a-cid"];
    for (const badCid of badCids) {
      try {
        await sendTx(await createAppendManifestInstruction(program, payer.publicKey, vId, badCid));
        expect.fail(`Should have failed for ${badCid}`);
      } catch (e: any) {
        expect(e.message).toContain("InvalidCidFormat");
      }
    }
  });

  it('B1: Deterministic Tie-breaker check (selectHead)', () => {
    const now = 1000;
    const entryA = { 
      manifestCid: "b_cid_aaaaa", 
      publishedAt: new BN(now),
      publisher: PublicKey.default,
      manifestCidHash: new Uint8Array(32).fill(0),
      manifestSchemaVersion: 1
    };
    const entryB = { 
      manifestCid: "b_cid_zzzzz", 
      publishedAt: new BN(now),
      publisher: PublicKey.default,
      manifestCidHash: new Uint8Array(32).fill(0),
      manifestSchemaVersion: 1
    };

    // Rule: if same publishedAt, pick manifestCid DESC (zzzzz > aaaaa)
    const head = registryService.selectHead([entryA as any, entryB as any]);
    expect(head?.manifestCid).toBe("b_cid_zzzzz");

    const headReverse = registryService.selectHead([entryB as any, entryA as any]);
    expect(headReverse?.manifestCid).toBe("b_cid_zzzzz");
  });
});
