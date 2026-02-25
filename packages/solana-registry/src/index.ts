import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import sjRegistryIdl from './idl/sj_registry_program.json';

// Program ID from declare_id! in lib.rs
export const PROGRAM_ID = new PublicKey("89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd");

export interface RegistryEntry {
  manifestCid: string;
  manifestCidHash: number[];
  publishedAt: number;
  publisher: PublicKey;
  manifestSchemaVersion: number;
}

export interface RegistryAccount {
  registryVersion: number;
  manifestSchemaVersion: number;
  wallet: PublicKey;
  vaultId: string;
  entries: RegistryEntry[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Derives the PDA for the registry account.
 * Seeds: ["SJ_REGISTRY_V1", walletPubKey, sha256(vaultId.trim().toLowerCase())]
 */
export function getRegistryAddress(wallet: PublicKey, vaultId: string, programId: PublicKey): PublicKey {
  const vaultIdCanonical = vaultId.trim().toLowerCase();
  const vaultIdHash = createHash('sha256').update(vaultIdCanonical).digest();
  
  const [address] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('SJ_REGISTRY_V1'),
      wallet.toBuffer(),
      vaultIdHash,
    ],
    programId
  );
  return address;
}

export function getProgram(connection: Connection, wallet: any, programId: PublicKey): Program {
  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: 'confirmed',
  });
  const program = new Program(sjRegistryIdl as any as Idl, provider);
  (program as any)._programId = programId;
  return program;
}

export async function fetchRegistry(
  connection: Connection,
  wallet: PublicKey,
  vaultId: string,
  programId: PublicKey
): Promise<RegistryAccount | null> {
  const address = getRegistryAddress(wallet, vaultId, programId);
  const program = new Program(sjRegistryIdl as any as Idl, { connection } as any);
  // Note: Anchor 0.30+ might ignore the ID in IDL if provider is basic. 
  // We ensure the ID matches by overriding it if necessary (though usually Idl has it).
  (program as any)._programId = programId;
  
  try {
    // @ts-ignore - dynamic property access on Idl program
    const account = await program.account.registryAccount.fetch(address);
    return account as any as RegistryAccount;
  } catch (e: any) {
    // Anchor/Web3 usually includes "Account does not exist" or similar in message for missing accounts
    const msg = e?.message ?? String(e);
    if (msg.includes('Account does not exist') || msg.includes('could not find')) {
      return null;
    }
    // Technical error (timeout, network, 429, etc) -> propagate
    throw e;
  }
}

export async function createInitRegistryInstruction(
  program: Program,
  wallet: PublicKey,
  vaultId: string,
  manifestSchemaVersion: number = 1,
  programId: PublicKey
): Promise<TransactionInstruction> {
  const address = getRegistryAddress(wallet, vaultId, programId);
  const vaultIdCanonical = vaultId.trim().toLowerCase();
  const vaultIdHash = Array.from(createHash('sha256').update(vaultIdCanonical).digest());
  
  return await program.methods
    .initRegistry(vaultId, vaultIdHash, manifestSchemaVersion)
    .accounts({
      registry: address,
      wallet: wallet,
      systemProgram: PublicKey.default,
    } as any)
    .instruction();
}

export async function createAppendManifestInstruction(
  program: Program,
  wallet: PublicKey,
  vaultId: string,
  manifestCid: string,
  manifestSchemaVersion: number = 1,
  programId: PublicKey
): Promise<TransactionInstruction> {
  const address = getRegistryAddress(wallet, vaultId, programId);
  const vaultIdCanonical = vaultId.trim().toLowerCase();
  const vaultIdHash = Array.from(createHash('sha256').update(vaultIdCanonical).digest());
  
  return await program.methods
    .appendManifest(vaultIdHash, manifestCid, manifestSchemaVersion)
    .accounts({
      registry: address,
      wallet: wallet,
    } as any)
    .instruction();
}
