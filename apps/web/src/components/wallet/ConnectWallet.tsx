'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'

import {
  truncateAddress,
  setLastWalletProvider,
  clearLastWalletProvider,
  clearIdentity,
  getLastWalletProvider,
} from './types'

type Props = {
  /**
   * Optional callback triggered when the user requests verification.
   * The Verify flow (message build + signature + verification) is implemented
   * in a separate component (Task 3 — VerifyWallet). This component only
   * exposes a callback so the parent can show that flow.
   */
  onRequestVerify?: () => void
  /**
   * Optional boolean indicating whether the identity has been verified.
   * Used to render Verified badge in the UI.
   */
  isVerified?: boolean
}

/**
 * ConnectWallet component
 *
 * Responsibilities:
 * - Detect Phantom (extension) presence.
 * - Support connecting / disconnecting Phantom either via wallet-adapter (preferred)
 *   or direct window.solana API (fallback).
 * - Display truncated address + copy action.
 * - Persist last provider to localStorage (`sj_lastWalletProvider`) via helpers.
 * - On disconnect or wallet/account change, clear persisted identity (`sj_identity`).
 *
 * Notes:
 * - This component expects the app may be wrapped in `WalletProvider` from
 *   `@solana/wallet-adapter-react`. If present it will use `useWallet()`. If not,
 *   it falls back to the legacy `window.solana` Phantom API.
 * - All crypto secrets / private keys are never persisted here.
 */
export const ConnectWallet: FC<Props> = ({ onRequestVerify, isVerified }) => {
  const wallet = useWallet() // may be a noop if not under WalletProvider
  const [hasPhantom, setHasPhantom] = useState<boolean>(false)
  const [publicKeyStr, setPublicKeyStr] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Detect Phantom via window.solana.isPhantom — guard SSR
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sol = (window as any).solana
    setHasPhantom(Boolean(sol && sol.isPhantom))
  }, [])

  // Derive address either from wallet-adapter or window.solana
  const addressFromAdapter = useMemo(() => {
    try {
      if (wallet && wallet.publicKey) {
        return wallet.publicKey.toBase58()
      }
    } catch {
      // ignore
    }
    return null
  }, [wallet])

  useEffect(() => {
    // prefer adapter publicKey, fallback to window.solana
    if (addressFromAdapter) {
      setPublicKeyStr(addressFromAdapter)
      return
    }
    if (typeof window === 'undefined') {
      setPublicKeyStr(null)
      return
    }
    const sol = (window as any).solana
    if (sol && sol.isPhantom && sol.publicKey) {
      try {
        const pk = new PublicKey(sol.publicKey).toBase58()
        setPublicKeyStr(pk)
      } catch {
        setPublicKeyStr(null)
      }
    } else {
      setPublicKeyStr(null)
    }
  }, [addressFromAdapter])

  // Listen to Phantom provider events (account change / connect / disconnect)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sol = (window as any).solana
    if (!sol || !sol.isPhantom) return

    const handleAccountChanged = (newPubKey: any) => {
      // if null => disconnected
      if (!newPubKey) {
        // clear persisted identity and last provider
        clearIdentity()
        clearLastWalletProvider()
        setPublicKeyStr(null)
        return
      }
      try {
        const pk = new PublicKey(newPubKey).toBase58()
        // If the account changed and we had a different one, clear identity (force reconnect/verify)
        const prev = getLastWalletProvider() ? prev : null
        // Always clear identity on account change to comply with Task 3 no hot-switch
        clearIdentity()
        setPublicKeyStr(pk)
      } catch {
        // ignore
      }
    }

    const handleConnect = (info: any) => {
      // Phantom may call connect with a publicKey
      if (info && info.publicKey) {
        try {
          const pk = new PublicKey(info.publicKey).toBase58()
          setPublicKeyStr(pk)
          setLastProviderIfPhantom()
        } catch {
          // ignore
        }
      }
    }

    const handleDisconnect = () => {
      clearIdentity()
      clearLastWalletProvider()
      setPublicKeyStr(null)
    }

    // Subscribe if the provider exposes event API
    if (sol.on) {
      try {
        sol.on('accountChanged', handleAccountChanged)
        sol.on('connect', handleConnect)
        sol.on('disconnect', handleDisconnect)
      } catch {
        // ignore if provider doesn't support events
      }
    }

    return () => {
      try {
        if (sol.removeListener) {
          sol.removeListener('accountChanged', handleAccountChanged)
          sol.removeListener('connect', handleConnect)
          sol.removeListener('disconnect', handleDisconnect)
        }
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLastProviderIfPhantom = useCallback(() => {
    // Persist last provider for UX (we only support phantom in MVP)
    try {
      setLastWalletProvider('phantom')
    } catch {
      // ignore
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      // Prefer wallet-adapter (if used by the app)
      if (wallet && wallet.connect && !wallet.connected) {
        await wallet.connect()
        // wallet.connect() should populate wallet.publicKey and connected flag
        setLastProviderIfPhantom()
        return
      }

      // Fallback to direct Phantom extension
      if (typeof window !== 'undefined') {
        const sol = (window as any).solana
        if (!sol) {
          setError('No Phantom detected')
          setConnecting(false)
          return
        }
        // Phantom connect returns an object with publicKey
        const res = await sol.connect()
        if (res && res.publicKey) {
          try {
            const pk = new PublicKey(res.publicKey).toBase58()
            setPublicKeyStr(pk)
            setLastProviderIfPhantom()
          } catch {
            // ignore
          }
          setConnecting(false)
          return
        }
      }

      setError('Unable to connect to wallet')
    } catch (err: any) {
      // User might reject or other error
      const msg = err?.message ?? String(err)
      setError(msg)
    } finally {
      setConnecting(false)
    }
  }, [wallet, setLastProviderIfPhantom])

  const disconnect = useCallback(async () => {
    setError(null)
    try {
      // Prefer wallet-adapter disconnect
      if (wallet && wallet.disconnect && wallet.connected) {
        await wallet.disconnect()
      } else if (typeof window !== 'undefined') {
        const sol = (window as any).solana
        if (sol && sol.isPhantom && sol.disconnect) {
          try {
            await sol.disconnect()
          } catch {
            // ignore disconnect errors
          }
        }
      }
    } catch (err: any) {
      // ignore minor disconnect errors but surface if relevant
      setError(err?.message ?? String(err))
    } finally {
      // Clear identity and last provider per spec (no secrets persisted)
      clearIdentity()
      clearLastWalletProvider()
      setPublicKeyStr(null)
    }
  }, [wallet])

  const copyAddress = useCallback(async () => {
    if (!publicKeyStr) return
    try {
      await navigator.clipboard.writeText(publicKeyStr)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [publicKeyStr])

  const handleVerifyClick = useCallback(() => {
    if (onRequestVerify) onRequestVerify()
  }, [onRequestVerify])

  const lastProvider = getLastWalletProvider()

  return (
    <div style={styles.container}>
      <div style={styles.row}>
        <div style={styles.badge}>
          Wallet:{' '}
          <span
            style={{
              ...styles.addr,
              color: publicKeyStr ? '#0b8' : '#999',
            }}
            title={publicKeyStr ?? 'Not connected'}
          >
            {publicKeyStr ? truncateAddress(publicKeyStr) : 'Not connected'}
          </span>
          {publicKeyStr && (
            <button onClick={copyAddress} style={styles.copyBtn} aria-label="Copy address">
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        <div style={styles.controls}>
          {!publicKeyStr ? (
            <>
              <button
                onClick={connect}
                style={styles.connectBtn}
                disabled={connecting}
                aria-disabled={connecting}
              >
                {connecting ? 'Connecting…' : 'Connect Wallet'}
              </button>
              {!hasPhantom && (
                <a
                  href="https://phantom.app/download"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.installLink}
                >
                  Install Phantom
                </a>
              )}
            </>
          ) : (
            <>
              <button onClick={disconnect} style={styles.disconnectBtn}>
                Disconnect
              </button>

              {/* Verify button is shown only when not yet verified */}
              {!isVerified ? (
                <button onClick={handleVerifyClick} style={styles.verifyBtn}>
                  Verify (Sign)
                </button>
              ) : (
                <span style={styles.verifiedBadge}>Verified</span>
              )}
            </>
          )}
        </div>
      </div>

      {lastProvider && !publicKeyStr && (
        <div style={styles.note}>Last used wallet: {lastProvider} (reconnect to restore)</div>
      )}

      {error && <div style={styles.error}>Error: {error}</div>}
    </div>
  )
}

/**
 * Minimal inline styles to keep the component standalone and easy to
 * integrate into the existing mock UI.
 */
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'stretch',
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    background: '#fff',
    fontSize: 14,
  },
  addr: {
    fontFamily: 'monospace',
    fontSize: 13,
    display: 'inline-block',
  },
  copyBtn: {
    marginLeft: 8,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
    borderRadius: 6,
  },
  controls: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  connectBtn: {
    padding: '8px 12px',
    background: '#06c',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  disconnectBtn: {
    padding: '6px 10px',
    background: '#fff',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: 8,
    cursor: 'pointer',
  },
  verifyBtn: {
    padding: '6px 10px',
    background: '#0a8',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  verifiedBadge: {
    padding: '6px 10px',
    background: '#e6ffed',
    color: '#046',
    borderRadius: 8,
    border: '1px solid #cef3d7',
    fontSize: 13,
  },
  installLink: {
    marginLeft: 8,
    color: '#06c',
    fontSize: 13,
    textDecoration: 'none',
  },
  note: {
    color: '#666',
    fontSize: 12,
  },
  error: {
    color: '#b00020',
    fontSize: 13,
  },
}

export default ConnectWallet
