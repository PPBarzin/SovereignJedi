'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'

import {
  Identity,
  IdentityState,
  loadIdentity,
  isVerified,
  truncateAddress,
  clearIdentity,
  getLastWalletProvider,
  STORAGE_KEY_IDENTITY,
} from './types'

/**
 * IdentityStatus
 *
 * Small UI component that displays the current identity state (DISCONNECTED,
 * CONNECTED_UNVERIFIED, CONNECTED_VERIFIED) and a compact summary of the
 * persisted identity stored in localStorage under `sj_identity`.
 *
 * Responsibilities:
 * - Observe localStorage for identity changes (storage event + polling fallback).
 * - Show truncated address, verification status, verifiedAt and expiresAt when present.
 * - Allow copying the full public key to clipboard.
 * - Allow clearing the persisted identity (useful for testing / disconnect flows).
 *
 * This component intentionally does not attempt to sign or connect wallets.
 * It only reflects and manipulates the minimal persisted identity state.
 */

type Props = {
  /**
   * Optional callback invoked when identity is cleared.
   * Useful for parent components to react (e.g. update UI / state machines).
   */
  onCleared?: () => void
  /**
   * Poll interval in ms to re-evaluate expiry if storage events aren't available.
   * Default: 5s.
   */
  pollIntervalMs?: number
}

export const IdentityStatus: FC<Props> = ({ onCleared, pollIntervalMs = 5000 }) => {
  const [identity, setIdentity] = useState<Identity | null>(() => {
    try {
      return loadIdentity()
    } catch {
      return null
    }
  })
  const [nowTs, setNowTs] = useState<number>(() => Date.now())
  const [copied, setCopied] = useState<boolean>(false)
  const lastProvider = useMemo(() => {
    try {
      return getLastWalletProvider()
    } catch {
      return null
    }
  }, [])

  // Derive the high-level state
  const state = useMemo<IdentityState>(() => {
    if (!identity || !identity.publicKey) return IdentityState.DISCONNECTED
    if (isVerified(identity, new Date(nowTs))) return IdentityState.CONNECTED_VERIFIED
    return IdentityState.CONNECTED_UNVERIFIED
  }, [identity, nowTs])

  // Refresh "now" periodically so UI updates when TTL expires
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), pollIntervalMs)
    return () => clearInterval(t)
  }, [pollIntervalMs])

  // Listen to storage events (multi-tab) to reflect changes in other tabs
  useEffect(() => {
    const handler = (ev: StorageEvent) => {
      if (ev.key === STORAGE_KEY_IDENTITY) {
        try {
          setIdentity(loadIdentity())
        } catch {
          setIdentity(null)
        }
      }
      if (ev.key === null) {
        // some APIs clear all storage; re-evaluate
        try {
          setIdentity(loadIdentity())
        } catch {
          setIdentity(null)
        }
      }
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    }
    return
  }, [])

  // Poll localStorage as a fallback in case storage events are not reliable
  useEffect(() => {
    let mounted = true
    const poll = () => {
      try {
        const current = loadIdentity()
        // shallow compare by JSON string to avoid unnecessary setState
        const prevStr = identity ? JSON.stringify(identity) : null
        const curStr = current ? JSON.stringify(current) : null
        if (prevStr !== curStr && mounted) {
          setIdentity(current)
        }
      } catch {
        if (mounted) setIdentity(null)
      }
    }
    const id = setInterval(poll, Math.max(2000, pollIntervalMs))
    return () => {
      mounted = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIntervalMs])

  const copyAddress = useCallback(async () => {
    if (!identity?.publicKey) return
    try {
      await navigator.clipboard.writeText(identity.publicKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [identity])

  const clear = useCallback(() => {
    try {
      clearIdentity()
      setIdentity(null)
      if (typeof onCleared === 'function') onCleared()
    } catch {
      // ignore
    }
  }, [onCleared])

  // Small helpers for display
  const statusBadge = useMemo(() => {
    switch (state) {
      case IdentityState.CONNECTED_VERIFIED:
        return { text: 'Verified', color: '#046' }
      case IdentityState.CONNECTED_UNVERIFIED:
        return { text: 'Connected (not verified)', color: '#b66' }
      case IdentityState.DISCONNECTED:
      default:
        return { text: 'Disconnected', color: '#666' }
    }
  }, [state])

  return (
    <div style={container}>
      <div style={row}>
        <div style={left}>
          <div style={title}>Identity</div>
          <div style={sub}>
            Status:{' '}
            <span style={{ color: statusBadge.color, fontWeight: 700 }}>{statusBadge.text}</span>
            {lastProvider ? <span style={providerNote}> • {lastProvider}</span> : null}
          </div>

          {identity && identity.publicKey ? (
            <div style={identityRow}>
              <span style={addr}>{truncateAddress(identity.publicKey)}</span>
              <button onClick={copyAddress} style={smallBtn}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <div style={hint}>No connected wallet detected.</div>
          )}
        </div>

        <div style={right}>
          {identity ? (
            <>
              <div style={meta}>
                <div style={metaRow}>
                  <div style={metaLabel}>Verified at</div>
                  <div style={metaValue}>{identity.verifiedAt ?? '—'}</div>
                </div>
                <div style={metaRow}>
                  <div style={metaLabel}>Expires at</div>
                  <div style={metaValue}>{identity.expiresAt ?? '—'}</div>
                </div>
                <div style={metaRow}>
                  <div style={metaLabel}>Nonce</div>
                  <div style={metaValue}>{identity.nonce ? identity.nonce.slice(0, 12) + '…' : '—'}</div>
                </div>
              </div>

              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={clear} style={dangerBtn}>
                  Clear identity
                </button>
              </div>
            </>
          ) : (
            <div style={noIdentityBox}>
              <div style={{ marginBottom: 8 }}>No identity persisted.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={clear} style={mutedBtn}>
                  Ensure cleared
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default IdentityStatus

/* Styles */
const container: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: '1px solid #e8e8e8',
  background: '#fff',
  fontSize: 13,
  maxWidth: 720,
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
}

const left: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 240,
}

const right: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  minWidth: 280,
}

const title: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
}

const sub: React.CSSProperties = {
  color: '#666',
  fontSize: 13,
}

const providerNote: React.CSSProperties = {
  color: '#999',
  fontWeight: 500,
  marginLeft: 6,
}

const identityRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginTop: 6,
}

const addr: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 13,
}

const smallBtn: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid #ddd',
  background: '#fff',
  cursor: 'pointer',
}

const meta: React.CSSProperties = {
  textAlign: 'right',
  minWidth: 260,
  background: '#fafafa',
  padding: 8,
  borderRadius: 8,
  border: '1px solid #f0f0f0',
}

const metaRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 6,
}

const metaLabel: React.CSSProperties = {
  color: '#666',
  fontSize: 12,
}

const metaValue: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: '#222',
}

const dangerBtn: React.CSSProperties = {
  padding: '8px 12px',
  background: '#fff',
  border: '1px solid #e0b4b4',
  color: '#b00020',
  borderRadius: 8,
  cursor: 'pointer',
}

const mutedBtn: React.CSSProperties = {
  padding: '8px 12px',
  background: '#fff',
  border: '1px solid #e6e6e6',
  color: '#333',
  borderRadius: 8,
  cursor: 'pointer',
}

const hint: React.CSSProperties = {
  color: '#666',
}

const noIdentityBox: React.CSSProperties = {
  textAlign: 'right',
  color: '#666',
  fontSize: 13,
}
