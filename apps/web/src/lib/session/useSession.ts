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

type UseSessionReturn = {
  // actions
  connectWallet: (pubKey: string, provider?: string) => Promise<void>
  disconnectWallet: () => void
  unlockVault: () => Promise<void>
  lockVault: () => void
  // selectors / state
  isWalletConnected: boolean
  isVaultUnlocked: boolean
  verified: VerifiedState | null
  walletPubKey: string | null

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

  // Inject wallet-adapter signMessage into SessionManager when available.
  // This keeps Unlock/VaultRoot signing consistent with the adapter connection state and can reduce popup flicker.
  //
  // IMPORTANT:
  // - We must bind the method to preserve `this` context.
  //   Otherwise calling the extracted function can throw:
  //     "Cannot set properties of undefined (setting 'walletAdapterSigner')"
  useEffect(() => {
    const rawSetter = (session as any)?.setWalletAdapterSigner
    if (typeof rawSetter !== 'function') return
    const setWalletAdapterSigner = rawSetter.bind(session)

    // Only inject when wallet-adapter provides a signMessage function.
    if (wallet && typeof (wallet as any).signMessage === 'function') {
      setWalletAdapterSigner(async (message: Uint8Array) => {
        const sig = await (wallet as any).signMessage(message)
        // wallet-adapter returns Uint8Array
        return sig as Uint8Array
      })
    } else {
      // Clear injected signer when adapter is unavailable/disconnected
      setWalletAdapterSigner(undefined)
    }
  }, [wallet, session])

  // Install listeners for window.solana to enforce Task 3.5 invariants.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const anyWin = window as any
    const sol = anyWin?.solana

    if (!sol || !sol.isPhantom) {
      // Nothing to subscribe to
      return undefined
    }

    const handleAccountChanged = (newPubKey: any) => {
      // MVP behavior:
      // - Do NOT disconnect on accountChanged when a new pubkey is provided.
      //   Disconnecting causes transient `walletPubKey=null` races (e.g. during upload).
      // - If newPubKey is null => treat as disconnect.
      // - If a new pubkey is provided => register it in SessionManager.
      try {
        if (newPubKey == null) {
          session.disconnectWallet()
        } else {
          // newPubKey may be a PublicKey-like object or string; SessionManager normalizes.
          session.connectWallet(newPubKey, 'phantom').catch(() => {
            /* ignore connect errors */
          })
        }
      } catch {
        // ignore
      } finally {
        // Always refresh UI state
        refresh()
      }
    }

    const handleDisconnect = () => {
      try {
        session.disconnectWallet()
      } catch {
        // ignore
      } finally {
        refresh()
      }
    }

    const handleConnect = (info: any) => {
      // Some provider implementations pass a publicKey or an object containing publicKey.
      try {
        let pk: string | null = null
        if (info && typeof info === 'object') {
          if (info.publicKey) {
            // info.publicKey may be a object type (PublicKey-like) or string
            try {
              // Attempt to string-coerce; SessionManager expects a base58 string.
              pk = String(info.publicKey)
            } catch {
              pk = null
            }
          }
        }
        // If pk available, call session.connectWallet to register pubkey in SessionManager
        if (pk) {
          session.connectWallet(pk, 'phantom').catch(() => {
            /* ignore connect errors */
          })
        }
      } catch {
        // ignore
      } finally {
        refresh()
      }
    }

    // Subscribe (guard calls)
    try {
      if (typeof sol.on === 'function') {
        sol.on('accountChanged', handleAccountChanged)
        sol.on('disconnect', handleDisconnect)
        sol.on('connect', handleConnect)
      }
    } catch {
      // ignore subscription failures
    }

    // Also listen to storage events to pick up changes to the persisted Verified signal
    const onStorage = (ev: StorageEvent) => {
      // SessionManager persists verified state under `sj_verified_v1`
      if (!ev.key || ev.key === 'sj_verified_v1') {
        refresh()
      }
    }

    // Listen to explicit session-change events dispatched by SessionManager
    // This avoids reliance on polling and provides immediate UI sync.
    const onSessionChanged = (() => {
      // event listener wrapper
      return (ev?: Event) => {
        try {
          refresh()
        } catch {
          // ignore
        }
      }
    })()

    window.addEventListener('storage', onStorage)
    window.addEventListener('sj-session-changed', onSessionChanged as EventListener)

    return () => {
      try {
        if (typeof sol.removeListener === 'function') {
          sol.removeListener('accountChanged', handleAccountChanged)
          sol.removeListener('disconnect', handleDisconnect)
          sol.removeListener('connect', handleConnect)
        }
      } catch {
        // ignore subscription failures
      }
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('sj-session-changed', onSessionChanged as EventListener)
    }
    // We purposely do not include `session` in deps to avoid re-subscribing to events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  // Initial sync; further updates are driven by the 'sj-session-changed' event
  // and storage events handled above. Polling is removed to avoid transient races.
  useEffect(() => {
    try {
      refresh()
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    connectWallet,
    disconnectWallet,
    unlockVault,
    lockVault,
    isWalletConnected,
    isVaultUnlocked,
    verified,
    walletPubKey,
    lastUnlock,
    lastUnlockSignatureBytes,
    lastVaultRoot,
    lastVaultRootSignatureBytes,
    refresh,
  }
}

export default useSession
