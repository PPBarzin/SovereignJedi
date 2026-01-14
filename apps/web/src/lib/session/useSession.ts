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
 */

import { useCallback, useEffect, useState } from 'react'
import type { VerifiedState } from './SessionManager'
import SessionManagerDefault, { session as sessionSingleton } from './SessionManager'

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

  const [walletPubKey, setWalletPubKey] = useState<string | null>(() => session.getWalletPubKey())
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean>(() => session.isVaultUnlocked())
  const [verified, setVerified] = useState<VerifiedState | null>(() => session.getVerified())
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(() => session.isWalletConnected())

  // Central refresh function to sync React state from SessionManager / storage
  const refresh = useCallback(() => {
    setWalletPubKey(session.getWalletPubKey())
    setIsVaultUnlocked(session.isVaultUnlocked())
    setVerified(session.getVerified())
    setIsWalletConnected(session.isWalletConnected())
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
      // NO HOT-SWITCH: on any account change, force disconnect at session level.
      // If newPubKey === null => treat as disconnect (also disconnects session).
      try {
        // Explicitly disconnect the SessionManager to clear in-memory vaultUnlocked state.
        session.disconnectWallet()
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
    window.addEventListener('storage', onStorage)

    return () => {
      try {
        if (typeof sol.removeListener === 'function') {
          sol.removeListener('accountChanged', handleAccountChanged)
          sol.removeListener('disconnect', handleDisconnect)
          sol.removeListener('connect', handleConnect)
        }
      } catch {
        // ignore
      }
      window.removeEventListener('storage', onStorage)
    }
    // We purposely do not include `session` in deps to avoid re-subscribing to events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  // Keep a small interval to refresh vault state in case it changes from other sources
  // (SessionManager is in-memory but UI and other components may update storage).
  useEffect(() => {
    const id = setInterval(() => {
      // Lightweight sync
      const vault = session.isVaultUnlocked()
      const prevVault = isVaultUnlocked
      if (vault !== prevVault) {
        setIsVaultUnlocked(vault)
      }
      const ver = session.getVerified()
      // shallow compare by reference/time
      if (ver?.expiresAt !== verified?.expiresAt || ver?.verifiedAt !== verified?.verifiedAt) {
        setVerified(ver)
      }
      const pub = session.getWalletPubKey()
      if (pub !== walletPubKey) {
        setWalletPubKey(pub)
        setIsWalletConnected(Boolean(pub))
      }
    }, 800) // small interval; keeps UI responsive but light-weight
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVaultUnlocked, verified, walletPubKey])

  return {
    connectWallet,
    disconnectWallet,
    unlockVault,
    lockVault,
    isWalletConnected,
    isVaultUnlocked,
    verified,
    walletPubKey,
    refresh,
  }
}

export default useSession
