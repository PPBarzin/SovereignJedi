/**
 * apps/web/src/lib/session/useSession.ts
 *
 * React hook exposing the SessionManager API to the UI.
 *
 * Responsibilities:
 * - Provide a single integration point between UI and the SessionManager singleton.
 * - Install lightweight listeners on `window.solana` to enforce Task 3.5 invariants:
 *   - On `accountChanged` => force session.disconnectWallet() (no hot-switch)
 *   - On `disconnect` => session.disconnectWallet()
 *   - On `connect` => call session.connectWallet(pubKey, 'phantom') when possible
 * - Expose helper methods and reactive state to components:
 *   - connectWallet(pubKey, provider)
 *   - disconnectWallet()
 *   - unlockVault()
 *   - lockVault()
 *   - isWalletConnected (boolean)
 *   - isVaultUnlocked (boolean)
 *   - verified (metadata or null)
 *   - walletPubKey (string | null)
 *
 * Notes:
 * - This hook does not modify SessionManager's internals.
 * - It treats the persisted Verified signal as UI-only metadata (as per Task 3.5).
 * - It does not persist vaultUnlocked (SessionManager enforces this).
 *
 * Task 6 (Manifest v1):
 * - Exposes BOTH:
 *   - Unlock Vault material (SJ_UNLOCK_V1) — session gating only (volatile + TTL)
 *   - Vault Root material (SJ_VAULT_ROOT_V1) — stable root to derive KEK for manifest across refresh
 *
 * Wallet signing UX (Phantom popup flicker):
 * - When available, we inject a wallet-adapter-based `signMessage` into SessionManager so Unlock/VaultRoot
 *   signatures are produced via the adapter path (more consistent with adapter connection state).
 */

import { useCallback, useEffect, useState } from 'react'
import type { BuildUnlockResult, BuildVaultRootResult } from '@sj/crypto'
import type { VerifiedState } from './SessionManager'
import SessionManagerDefault, { session as sessionSingleton } from './SessionManager'
import { useWallet } from '@solana/wallet-adapter-react'
import { registryService } from '../solana/RegistryService'
import type { RegistryAccount } from '@sj/solana-registry'

type UseSessionReturn = {
  // actions
  connectWallet: (pubKey: string, provider?: string) => Promise<void>
  disconnectWallet: () => void
  unlockVault: () => Promise<void>
  lockVault: () => void
  publishManifest: (manifestCid: string) => Promise<string>
  // selectors / state
  isWalletConnected: boolean
  isVaultUnlocked: boolean
  verified: VerifiedState | null
  walletPubKey: string | null
  onChainRegistry: RegistryAccount | null

  /**
   * Task 6:
   * Unlock Vault material (SJ_UNLOCK_V1) — volatile, TTL-enforced, session gating only.
   * MUST NOT be used to derive a stable KEK for cross-refresh persistence.
   */
  lastUnlock: BuildUnlockResult | null
  lastUnlockSignatureBytes: Uint8Array | null

  /**
   * Task 6:
   * Vault Root material (SJ_VAULT_ROOT_V1) — stable, re-signable after refresh.
   * This is the ONLY valid root to derive the stable KEK used to unwrap/decrypt the manifest.
   */
  lastVaultRoot: BuildVaultRootResult | null
  lastVaultRootSignatureBytes: Uint8Array | null

  // utility
  refresh: () => void
}

/**
 * useSession
 *
 * Provide a minimal reactive wrapper around the SessionManager singleton.
 */
export function useSession(): UseSessionReturn {
  // Use the singleton session instance created in SessionManager.ts
  const session: SessionManagerDefault = sessionSingleton as any

  // Wallet-adapter (preferred signing path when available)
  const wallet = useWallet()

  const [walletPubKey, setWalletPubKey] = useState<string | null>(() => session.getWalletPubKey())
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean>(() => session.isVaultUnlocked())
  const [verified, setVerified] = useState<VerifiedState | null>(() => session.getVerified())
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(() => session.isWalletConnected())
  const [onChainRegistry, setOnChainRegistry] = useState<RegistryAccount | null>(null)

  // Task 6: in-memory Unlock Vault material (SJ_UNLOCK_V1)
  const [lastUnlock, setLastUnlock] = useState<BuildUnlockResult | null>(
    () => (session as any).getLastUnlock?.() ?? null
  )
  const [lastUnlockSignatureBytes, setLastUnlockSignatureBytes] = useState<Uint8Array | null>(
    () => (session as any).getLastUnlockSignatureBytes?.() ?? null
  )

  // Task 6: in-memory Vault Root material (SJ_VAULT_ROOT_V1)
  const [lastVaultRoot, setLastVaultRoot] = useState<BuildVaultRootResult | null>(
    () => (session as any).getLastVaultRoot?.() ?? null
  )
  const [lastVaultRootSignatureBytes, setLastVaultRootSignatureBytes] = useState<Uint8Array | null>(
    () => (session as any).getLastVaultRootSignatureBytes?.() ?? null
  )

  // Central refresh function to sync React state from SessionManager / storage
  const refresh = useCallback(() => {
    setWalletPubKey(session.getWalletPubKey())
    setIsVaultUnlocked(session.isVaultUnlocked())
    setVerified(session.getVerified())
    setIsWalletConnected(session.isWalletConnected())

    // Task 6: keep unlock material in sync (memory-only)
    setLastUnlock((session as any).getLastUnlock?.() ?? null)
    setLastUnlockSignatureBytes((session as any).getLastUnlockSignatureBytes?.() ?? null)

    // Task 6: keep vault-root material in sync (memory-only)
    setLastVaultRoot((session as any).getLastVaultRoot?.() ?? null)
    setLastVaultRootSignatureBytes((session as any).getLastVaultRootSignatureBytes?.() ?? null)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actions
  const connectWallet = useCallback(
    async (pubKey: string, provider?: string) => {
      await session.connectWallet(pubKey, provider)
      // sync state immediately
      refresh()
    },
    [refresh, session],
  )

  const disconnectWallet = useCallback(() => {
    session.disconnectWallet()
    setOnChainRegistry(null)
    // sync state
    refresh()
  }, [refresh, session])

  const unlockVault = useCallback(async () => {
    await session.unlockVault()
    // Only vaultUnlocked is memory-only; Verified may be persisted by SessionManager
    refresh()
  }, [refresh, session])

  const lockVault = useCallback(() => {
    session.lockVault()
    refresh()
  }, [refresh, session])

  const publishManifest = useCallback(async (manifestCid: string) => {
    if (!wallet.publicKey || !wallet.connected) throw new Error('Wallet not connected')
    const signature = await registryService.publishManifest(wallet, 'local-default', manifestCid)
    // Refresh registry state
    const reg = await registryService.getRegistry(wallet.publicKey.toBase58(), 'local-default')
    setOnChainRegistry(reg)
    return signature
  }, [wallet])

  // Fetch registry on-chain when wallet is connected
  useEffect(() => {
    if (walletPubKey) {
      void (async () => {
        const reg = await registryService.getRegistry(walletPubKey, 'local-default')
        setOnChainRegistry(reg)
      })()
    }
  }, [walletPubKey])

  return {
    connectWallet,
    disconnectWallet,
    unlockVault,
    lockVault,
    publishManifest,
    isWalletConnected,
    isVaultUnlocked,
    verified,
    walletPubKey,
    onChainRegistry,
    lastUnlock,
    lastUnlockSignatureBytes,
    lastVaultRoot,
    lastVaultRootSignatureBytes,
    refresh,
  }
}

export default useSession
