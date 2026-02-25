import { PublicKey } from '@solana/web3.js';

export type SolanaCluster = 'localnet' | 'devnet' | 'mainnet-beta';

/**
 * Centralized Solana configuration helper.
 * Resolves cluster, RPC URL, and Program ID from environment variables.
 */

export function getSolanaCluster(): SolanaCluster {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'devnet';
  if (cluster === 'localnet' || cluster === 'devnet' || cluster === 'mainnet-beta') {
    return cluster as SolanaCluster;
  }
  return 'devnet';
}

export function getSolanaRpcUrl(): string {
  // 1. Priority: Explicit override
  if (process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
    return process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  }

  // 2. Mapping by cluster
  const cluster = getSolanaCluster();
  switch (cluster) {
    case 'localnet':
      return 'http://127.0.0.1:8899';
    case 'devnet':
      return 'https://api.devnet.solana.com';
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    default:
      return 'https://api.devnet.solana.com';
  }
}

export function getRegistryProgramId(): PublicKey {
  const envId = process.env.NEXT_PUBLIC_SJ_REGISTRY_PROGRAM_ID;
  if (envId) {
    return new PublicKey(envId);
  }

  const cluster = getSolanaCluster();
  // For localnet, we can fallback to the hardcoded ID from the latest deployment
  // if not provided in ENV.
  if (cluster === 'localnet') {
    // Current stable localnet ID
    return new PublicKey('89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd');
  }

  // For devnet/mainnet, we MUST throw if the ID is missing to avoid silent failures
  throw new Error(`CRITICAL: NEXT_PUBLIC_SJ_REGISTRY_PROGRAM_ID is missing for cluster ${cluster}.`);
}

export function getExplorerUrl(txOrAddress: string, type: 'tx' | 'address' = 'tx'): string {
  const cluster = getSolanaCluster();
  const base = `https://explorer.solana.com/${type}/${txOrAddress}`;
  
  if (cluster === 'localnet') return `${base}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
  if (cluster === 'mainnet-beta') return base;
  return `${base}?cluster=${cluster}`;
}

// Debug: log config at module load time (client side)
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SJ_DEBUG === 'true') {
  console.log('[SJ-DEBUG][SolanaConfig] Configuration initialized', {
    cluster: getSolanaCluster(),
    rpcUrl: getSolanaRpcUrl(),
    programId: getRegistryProgramId().toBase58(),
  });
}
