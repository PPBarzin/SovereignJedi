import { Connection, PublicKey } from '@solana/web3.js';
import { 
  fetchRegistry, 
  getProgram, 
  createInitRegistryInstruction, 
  createAppendManifestInstruction,
  RegistryAccount,
  RegistryEntry
} from '@sj/solana-registry';
import { withRetry } from '../utils/RetryUtils';
import { getSolanaRpcUrl, getRegistryProgramId } from './solanaConfig';

// Config
const RPC_TIMEOUT = parseInt(process.env.NEXT_PUBLIC_SJ_SOLANA_RPC_TIMEOUT_MS || '8000', 10);
const RPC_RETRIES = parseInt(process.env.NEXT_PUBLIC_SJ_SOLANA_RPC_RETRIES || '2', 10);
const IPFS_TIMEOUT = parseInt(process.env.NEXT_PUBLIC_SJ_IPFS_TIMEOUT_MS || '12000', 10);
const IPFS_RETRIES = parseInt(process.env.NEXT_PUBLIC_SJ_IPFS_RETRIES || '3', 10);
const RETRY_BACKOFF = parseInt(process.env.NEXT_PUBLIC_SJ_RETRY_BACKOFF_MS || '300', 10);

export class RegistryService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(getSolanaRpcUrl(), {
      commitment: 'confirmed',
      fetchMiddleware: async (url, options, next) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), RPC_TIMEOUT);
        try {
          return await next(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(id);
        }
      }
    });
  }

  /**
   * Fetches the registry with retry policy.
   */
  async getRegistry(walletPubKey: string, vaultId: string = 'local-default'): Promise<RegistryAccount | null> {
    try {
      const programId = getRegistryProgramId();
      return await withRetry(
        () => {
          const wallet = new PublicKey(walletPubKey);
          return fetchRegistry(this.connection, wallet, vaultId, programId);
        },
        { 
          retries: RPC_RETRIES, 
          backoffMs: RETRY_BACKOFF,
          onRetry: (attempt, err) => {
            if (process.env.NEXT_PUBLIC_SJ_DEBUG === 'true') {
              console.debug(`[RegistryService] RPC Retry ${attempt}/${RPC_RETRIES}`, err);
            }
          }
        }
      );
    } catch (err: any) {
      if (process.env.NEXT_PUBLIC_SJ_DEBUG === 'true') {
        console.error('[RegistryService] Failed to fetch registry', err);
      }
      return null;
    }
  }

  /**
   * Deterministic head selection (STEEL).
   * Sort by publishedAt DESC, then by manifestCid DESC (lexicographical tie-breaker).
   */
  selectHead(entries: RegistryEntry[]): RegistryEntry | null {
    if (!entries || entries.length === 0) return null;
    
    return [...entries].sort((a, b) => {
      const timeA = a.publishedAt;
      const timeB = b.publishedAt;
      
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      // Deterministic tie-breaker: manifestCid DESC (lexicographical)
      return b.manifestCid.localeCompare(a.manifestCid);
    })[0];
  }

  getLatestEntry(entries: RegistryEntry[]): RegistryEntry | null {
    return this.selectHead(entries);
  }

  /**
   * Fetches manifest from IPFS with retry policy.
   */
  async getManifestFromIpfs(manifestCid: string): Promise<Uint8Array> {
    return withRetry(
      async () => {
        const { catBytes } = await import('@sj/ipfs');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), IPFS_TIMEOUT);
        try {
          return await catBytes(manifestCid);
        } finally {
          clearTimeout(timer);
        }
      },
      { 
        retries: IPFS_RETRIES, 
        backoffMs: RETRY_BACKOFF,
        onRetry: (attempt) => {
          if (process.env.NEXT_PUBLIC_SJ_DEBUG === 'true') {
            console.debug(`[RegistryService] IPFS Cat Retry ${attempt}/${IPFS_RETRIES}`);
          }
        }
      }
    );
  }

  async publishManifest(
    wallet: any, 
    vaultId: string,
    manifestCid: string,
    manifestSchemaVersion: number = 1
  ): Promise<string> {
    const programId = getRegistryProgramId();
    const program = getProgram(this.connection, wallet, programId);
    const registry = await this.getRegistry(wallet.publicKey.toBase58(), vaultId);
    
    const { Transaction } = await import('@solana/web3.js');
    const tx = new Transaction();

    if (!registry) {
      const initIx = await createInitRegistryInstruction(
        program,
        wallet.publicKey,
        vaultId,
        manifestSchemaVersion,
        programId
      );
      tx.add(initIx);
    }

    const appendIx = await createAppendManifestInstruction(
      program,
      wallet.publicKey,
      vaultId,
      manifestCid,
      manifestSchemaVersion,
      programId
    );
    tx.add(appendIx);

    const signature = await wallet.sendTransaction(tx, this.connection);
    await this.connection.confirmTransaction(signature, 'confirmed');
    
    return signature;
  }
}

export const registryService = new RegistryService();

