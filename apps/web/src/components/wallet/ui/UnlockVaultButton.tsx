/**
 * apps/web/src/components/wallet/ui/UnlockVaultButton.tsx
 *
 * Minimal button to trigger SessionManager.unlockVault() via useSession hook.
 *
 * - Visible only when a wallet is connected.
 * - Calls `unlockVault()` when clicked.
 * - Shows simple loading / error / success feedback.
 *
 * Notes:
 * - Does NOT persist any secrets and does not modify SessionManager internals.
 * - Conforms to Task 3.5: unlock is explicit, no automatic retries, no implicit unlocks.
 */

'use client'

import React, { useCallback, useEffect, useState } from 'react'
import useSession from '../../../lib/session/useSession'
import { useWallet } from '@solana/wallet-adapter-react'

const styles: Record<string, React.CSSProperties> = {
  btn: {
    padding: '12px 18px',
    borderRadius: 10,
    cursor: 'pointer',
    fontWeight: 800,
    border: 'none',
    background: '#008fc7',
    color: 'white',
    fontSize: 15,
    boxShadow: '0 6px 18px rgba(11,147,199,0.18)',
  },
  btnMuted: {
    padding: '10px 14px',
    borderRadius: 10,
    cursor: 'not-allowed',
    fontWeight: 700,
    border: '1px solid rgba(0,0,0,0.04)',
    background: '#9fbfd6',
    color: 'white',
    opacity: 0.95,
  },
  wrapper: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-start',
  },
  msg: {
    fontSize: 13,
    color: '#ef4444',
  },
  okMsg: {
    fontSize: 13,
    color: '#059669',
  },
}

/**
 * UnlockVaultButton
 *
 * Props: none (keeps the component intentionally minimal for OQ)
 */
export default function UnlockVaultButton(): JSX.Element | null {
  if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true") {
      console.log("[SJ-DEBUG][UNLOCK] UnlockVaultButton mounted");
    }
  const wallet = useWallet()
  const {
    isWalletConnected,
    isVaultUnlocked,
    unlockVault,
    walletPubKey,
    // other helpers available from hook if needed
  } = useSession()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justUnlocked, setJustUnlocked] = useState(false)

  useEffect(() => {
    // clear transient success state if vault becomes locked again
    if (!isVaultUnlocked) {
      setJustUnlocked(false)
    }
  }, [isVaultUnlocked])

  const handleClick = useCallback(async () => {
    // [SJ-DEBUG][UNLOCK] Button clicked
    if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true") {
      console.log('[SJ-DEBUG][UNLOCK] Button clicked')
    }

    // [SJ-DEBUG][UNLOCK] Wallet state
    if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true") {
      console.log(`[SJ-DEBUG][UNLOCK] Wallet state: {
  connected: ${wallet.connected},
  publicKey: ${wallet.publicKey?.toBase58()},
  hasSignMessage: ${typeof wallet.signMessage},
  vaultUnlocked: ${isVaultUnlocked},
  isUnlocking: ${loading}
}`)
    }

    setError(null)
    setLoading(true)
    try {
      // MVP rule: no window.solana fallback here.
      // The wallet-adapter connection must be registered in SessionManager via the central sync.
      if (!isWalletConnected || !walletPubKey) {
        // [SJ-DEBUG][UNLOCK] Early return: Connect requis avant Unlock Vault.
        if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true") {
          console.log('[SJ-DEBUG][UNLOCK] Early return: Connect requis avant Unlock Vault.')
        }
        throw new Error('Connect requis avant Unlock Vault.')
      }

      // call the session-level unlock (will request wallet signatures)
      await unlockVault()
      // on success, UI will reflect session.isVaultUnlocked()
      setJustUnlocked(true)
    } catch (err: any) {
      // [SJ-DEBUG][UNLOCK] Signature error
      if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true") {
        console.log(`[SJ-DEBUG][UNLOCK] Signature error: ${err?.message ?? String(err)}`)
      }
      // surface a safe error message for UX. Do not log or persist sensitive data.
      const msg = err?.message ?? String(err ?? 'Unknown error')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [unlockVault, isWalletConnected, walletPubKey])

  // Adapter-driven truth only:
  // Hide Unlock action unless the wallet-adapter connection is active AND SessionManager has the pubkey.
  if (!isWalletConnected || !walletPubKey) {
    if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true" && !isWalletConnected) {
       // Optional: log if button hidden due to connection
    }
    return null
  }

  // If vault already unlocked, show disabled prominent state
  if (isVaultUnlocked) {
    if (process.env.NEXT_PUBLIC_SJ_DEBUG === "true" && isVaultUnlocked) {
       // [SJ-DEBUG][UNLOCK] Early return: Vault already unlocked (UI gate)
    }
    return (
      <div style={{ ...styles.wrapper, alignItems: 'center' }}>
        <button style={{ ...styles.btnMuted, minWidth: 220 }} disabled>
          Vault Unlocked — Uploads Enabled
        </button>
        {justUnlocked && <div style={styles.okMsg}>Vault unlocked for this session.</div>}
      </div>
    )
  }

  return (
    <div style={{ ...styles.wrapper, alignItems: 'center' }}>
      <button
        onClick={() => void handleClick()}
        style={loading ? { ...styles.btnMuted, minWidth: 260 } : { ...styles.btn, minWidth: 260, fontSize: 15, padding: '12px 18px', boxShadow: '0 6px 18px rgba(11,147,199,0.24)' }}
        disabled={loading}
        aria-disabled={loading}
      >
        {loading ? 'Unlocking…' : 'Unlock Vault (required to upload)'}
      </button>
      {/*<button
        onClick={() => {
          console.log("CLICK DIRECT TEST");
        }}
        style={{
          background: "red",
          color: "white",
          padding: "14px 20px",
          borderRadius: 10,
          border: "none",
          fontWeight: 800,
          minWidth: 260,
          position: "relative",
          zIndex: 9999
        }}
      >
        TEST CLICK
        </button>*/}

      {error && <div role="alert" style={{ ...styles.msg, marginTop: 8 }}>Error: {error}</div>}
      {!isVaultUnlocked && !loading && (
        <div style={{ marginTop: 6, fontSize: 13, color: '#f87171', maxWidth: 360 }}>
          Vault locked — click "<strong>Unlock Vault (required to upload)</strong>" and approve the signature to unlock for this session.
        </div>
      )}
    </div>
  )
}
