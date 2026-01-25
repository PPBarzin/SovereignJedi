'use client'

import React, { useCallback, useState } from 'react'
import useSession from '../../../lib/session/useSession'

/**
 * ProtectedAction
 *
 * Minimal protected UI action used for OQ validation of Task 3.5.
 *
 * Behavior:
 * - When clicked, attempts to perform a protected action that requires the Vault
 *   to be unlocked for the current session.
 * - If the vault is not unlocked, the action reports a clear, actionable message
 *   instructing the user to use the explicit "Unlock Vault" control.
 * - The UI surfaces success or error messages to the user in a non-sensitive way.
 *
 * Notes:
 * - This component intentionally does not persist anything or handle secrets.
 * - It relies on the SessionManager integration exposed via `useSession`.
 * - The protected action itself is a placeholder (no backend / no cryptography).
 */

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-start',
  },
  btn: {
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid rgba(0,0,0,0.08)',
    background: '#0b93c7',
    color: '#fff',
    fontWeight: 700,
  },
  btnMuted: {
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'not-allowed',
    border: '1px solid rgba(0,0,0,0.04)',
    background: '#9fbfd6',
    color: '#fff',
    fontWeight: 700,
    opacity: 0.9,
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
  },
  ok: {
    color: '#059669',
    fontSize: 13,
  },
}

/**
 * performProtectedAction
 *
 * Synchronous function that enforces the Task 3.5 invariant: it MUST throw
 * if the vault is locked. This mirrors the OQ expectation and is intentionally
 * simple so test/protocol can observe the thrown error or the successful path.
 *
 * NOTE: We keep the thrown error message concise ("Vault locked") and translate
 * it to a more actionable UX message in the component's catch handler so the
 * user is guided to the explicit Unlock flow.
 */
function performProtectedAction(session: ReturnType<typeof useSession>) {
  if (!session.isVaultUnlocked) {
    // This is the explicit failure mode required by the Task 3.5 spec
    throw new Error('Vault locked')
  }

  // Placeholder for the protected action.
  // No secrets, no network, no crypto — just a marker that the action is allowed.
  return { ok: true, message: 'Protected action succeeded — vault is unlocked for this session' }
}

export default function ProtectedAction(): JSX.Element {
  const session = useSession()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const onClick = useCallback(async () => {
    setError(null)
    setSuccess(null)

    setLoading(true)
    try {
      // Run the guarded action. It will throw if the vault is not unlocked.
      // We call it synchronously to preserve the exact thrown Error("Vault locked")
      // semantics, and then catch here to display a friendly UI message.
      const result = performProtectedAction(session)
      if (result && result.ok) {
        setSuccess(result.message)
      } else {
        setError('Protected action failed')
      }
    } catch (err: any) {
      // Surface a safe, actionable error message. Do not include any sensitive data.
      const rawMsg = err?.message ?? String(err ?? 'Unknown error')
      if (rawMsg === 'Vault locked') {
        // Provide a clear, user-facing instruction pointing to the explicit Unlock control.
        setError('Vault locked — please click "Unlock Vault" and approve the signature to unlock for this session.')
      } else {
        setError(rawMsg)
      }
    } finally {
      setLoading(false)
    }
  }, [session])

  // The button is shown even when wallet disconnected so the tester can verify
  // that the action fails clearly in that case as well.
  // If you prefer a different visibility rule, adjust accordingly in OQ.
  return (
    <div style={styles.wrapper}>
      <button
        onClick={() => void onClick()}
        style={loading ? styles.btnMuted : styles.btn}
        disabled={loading}
        aria-disabled={loading}
      >
        {loading ? 'Running…' : 'Access Vault (Protected Action)'}
      </button>

      {error && (
        <div role="alert" style={styles.error}>
          Error: {error}
        </div>
      )}

      {success && (
        <div role="status" style={styles.ok}>
          {success}
        </div>
      )}
    </div>
  )
}
