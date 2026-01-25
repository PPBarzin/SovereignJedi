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

const styles: Record<string, React.CSSProperties> = {
  btn: {
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 700,
    border: '1px solid rgba(0,0,0,0.08)',
    background: '#0b93c7',
    color: 'white',
  },
  btnMuted: {
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'not-allowed',
    fontWeight: 700,
    border: '1px solid rgba(0,0,0,0.04)',
    background: '#9fbfd6',
    color: 'white',
    opacity: 0.9,
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
    setError(null)
    setLoading(true)
    try {
      // call the session-level unlock (will request wallet signature)
      await unlockVault()
      // on success, UI will reflect session.isVaultUnlocked()
      setJustUnlocked(true)
    } catch (err: any) {
      // surface a safe error message for UX. Do not log or persist sensitive data.
      const msg = err?.message ?? String(err ?? 'Unknown error')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [unlockVault])

  // Button visible when a wallet pubkey exists (supports adapter-provided pubkey)
  // We show the Unlock action if either the session reports a connected wallet
  // or if a wallet pubkey is available from the provider.
  if (!isWalletConnected && !walletPubKey) return null

  // If vault already unlocked, show disabled state
  if (isVaultUnlocked) {
    return (
      <div style={styles.wrapper}>
        <button style={styles.btnMuted} disabled>
          Vault Unlocked
        </button>
        {justUnlocked && <div style={styles.okMsg}>Vault unlocked for this session.</div>}
      </div>
    )
  }

  return (
    <div style={styles.wrapper}>
      <button
        onClick={() => void handleClick()}
        style={loading ? styles.btnMuted : styles.btn}
        disabled={loading}
        aria-disabled={loading}
      >
        {loading ? 'Unlocking…' : 'Unlock Vault'}
      </button>

      {error && <div role="alert" style={styles.msg}>Error: {error}</div>}
    </div>
  )
}
