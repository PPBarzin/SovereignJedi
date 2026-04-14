'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
// wallet-adapter only (no window.solana fallback)
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import useSession from '../../lib/session/useSession'
import { session as sessionSingleton } from '../../lib/session/SessionManager'
import { getManifestCid } from '@sj/manifest'

 // ProgDec moved to docs/progdec/T03-D001-wallet-ui.md — remove inline decision notes.
 // See docs/progdec/T03-D001-wallet-ui.md for rationale and traceability.

 import {
   truncateAddress,
   setLastWalletProvider,
   clearLastWalletProvider,
   clearIdentity,
   getLastWalletProvider,
 } from './types'

 // Shared theme tokens for consistent dark/bluish UI across wallet components
 import { getTokens } from './theme'

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
 * - Wallet-adapter UI only (no passive connection / no window.solana fallback).
 * - Display truncated address + copy action.
 * - Persist last provider to localStorage (`sj_lastWalletProvider`) via helpers.
 * - On disconnect, clear persisted identity (`sj_identity`).
 *
 * Notes:
 * - This component requires the app to be wrapped in `WalletProvider` from
 *   `@solana/wallet-adapter-react` (provided in `_app.tsx`).
 * - Session synchronization is adapter-driven:
 *     useEffect([wallet.connected, wallet.publicKey]) ->
 *       connected+pubkey => session.connectWallet(pubkeyBase58, providerName)
 *       else             => session.disconnectWallet()
 * - All crypto secrets / private keys are never persisted here.
 */
export const ConnectWallet: FC<Props> = ({ onRequestVerify, isVerified }) => {
  const wallet = useWallet()
  const { connectWallet, walletPubKey, isVaultUnlocked, isWalletConnected, onChainRegistry, publishManifest } = useSession()
  const [publicKeyStr, setPublicKeyStr] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const localManifestCid = useMemo(() => {
    if (!walletPubKey) return null
    try {
      return getManifestCid(walletPubKey)
    } catch {
      return null
    }
  }, [walletPubKey])

  const onChainLatestManifestCid = useMemo(() => {
    if (!onChainRegistry?.entries || onChainRegistry.entries.length === 0) return null
    // Delegate to canonical selectHead (publishedAt DESC, then manifestCid DESC)
    const { registryService } = require('../../lib/solana/RegistryService')
    const head = registryService.selectHead(onChainRegistry.entries)
    return head?.manifestCid ?? null
  }, [onChainRegistry])

  const isUpToDate = localManifestCid === onChainLatestManifestCid

  const SJ_DEBUG = String(process.env.NEXT_PUBLIC_SJ_DEBUG).toLowerCase() === 'true'

  // Adapter-only derived address: only when wallet is actually connected
  const addressFromAdapter = useMemo(() => {
    try {
      if (wallet?.connected && wallet.publicKey) {
        return wallet.publicKey.toBase58()
      }
    } catch {
      // ignore
    }
    return null
  }, [wallet?.connected, wallet?.publicKey])

  // Debug: track wallet-adapter changes (adapter is the ONLY source of truth here)
  useEffect(() => {
    if (!SJ_DEBUG) return
    // eslint-disable-next-line no-console
    console.debug('[SJ_DEBUG][ConnectWallet] wallet-adapter state changed', {
      connected: Boolean(wallet?.connected),
      adapterPublicKey: addressFromAdapter,
    })
  }, [SJ_DEBUG, wallet?.connected, addressFromAdapter])

  // Single synchronization point (adapter -> SessionManager)
  useEffect(() => {
    // publicKeyStr is UI-only; it should reflect adapter state only
    setPublicKeyStr(addressFromAdapter ?? null)

    // Session sync: do NOT call connectWallet until wallet.connected is true
    if (wallet?.connected && addressFromAdapter) {
      try {
        if (SJ_DEBUG) {
          // eslint-disable-next-line no-console
          console.debug('[SJ_DEBUG][ConnectWallet] sync -> session.connectWallet(from adapter)', {
            pubKey: addressFromAdapter,
            provider: 'phantom',
          })
        }
        void connectWallet(addressFromAdapter, 'phantom')

        if (SJ_DEBUG) {
          // eslint-disable-next-line no-console
          console.debug('[SJ_DEBUG][ConnectWallet] session.instanceId / walletPubKey (post-sync)', {
            instanceId: (sessionSingleton as any)?.instanceId,
            walletPubKey: walletPubKey,
          })
        }
      } catch {
        /* ignore */
      }
    }

    // IMPORTANT (MVP):
    // Do NOT auto-disconnect SessionManager when the adapter is temporarily not connected.
    // Disconnect should come from an explicit user action (wallet.disconnect())
    // or provider events (disconnect / accountChanged(null)) handled centrally.
  }, [SJ_DEBUG, wallet?.connected, addressFromAdapter, connectWallet, walletPubKey])

  // Debug: track SessionManager pubkey changes (the one used by upload/manifest)
  useEffect(() => {
    if (!SJ_DEBUG) return
    // eslint-disable-next-line no-console
    console.debug('[SJ_DEBUG][ConnectWallet] session state changed', {
      sessionWalletPubKey: walletPubKey,
      isVaultUnlocked,
      isWalletConnected,
    })
  }, [SJ_DEBUG, walletPubKey, isVaultUnlocked, isWalletConnected])

  // Provider event handling has been centralized in the session layer (useSession)
  // to avoid duplicate listeners and race conditions. ConnectWallet remains a UI
  // controller and no longer attaches provider event listeners.
  useEffect(() => {
    // Intentionally no-op: session hook installs provider listeners.
    // This keeps ConnectWallet focused on UI responsibilities only.
    return () => {}
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
      // Wallet-adapter only: connect via adapter.
      if (wallet && wallet.connect && !wallet.connected) {
        await wallet.connect()
        setLastProviderIfPhantom()
        return
      }
      if (!wallet || !wallet.connect) {
        setError('Wallet adapter unavailable')
        return
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      setError(msg)
    } finally {
      setConnecting(false)
    }
  }, [wallet, setLastProviderIfPhantom])

  const disconnect = useCallback(async () => {
    setError(null)
    try {
      // Wallet-adapter only: disconnect via adapter.
      if (wallet && wallet.disconnect && wallet.connected) {
        await wallet.disconnect()
      }
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      // SessionManager must follow adapter state via the sync effect (do not call disconnectWallet here).
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
  // Use shared tokens (dark theme) to keep card/button colors consistent across components
  const tokens = getTokens('dark')

  return (
    <div style={{ ...styles.container, background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, color: tokens.text }}>
      <div style={styles.row}>
        <div style={{ ...styles.badge, background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, color: tokens.text }}>
          Wallet:{' '}
          <span
            style={{
              ...styles.addr,
              color: publicKeyStr ? tokens.ok : tokens.subtext,
            }}
            title={publicKeyStr ?? 'Not connected'}
          >
            {publicKeyStr ? truncateAddress(publicKeyStr) : 'Not connected'}
          </span>
          {publicKeyStr && (
            <button onClick={copyAddress} style={{ ...styles.copyBtn, border: tokens.btnMutedBorder, background: tokens.btnMutedBg, color: tokens.btnMutedText }} aria-label="Copy address">
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        <div style={styles.controls}>
          {!publicKeyStr ? (
            <>
              <WalletMultiButton />
              <a
                href="https://phantom.app/download"
                target="_blank"
                rel="noreferrer"
                style={styles.installLink}
              >
                Install Phantom
              </a>
            </>
          ) : (
            <>
              <button onClick={disconnect} style={{ ...styles.disconnectBtn, background: tokens.btnMutedBg, border: tokens.btnMutedBorder, color: tokens.btnMutedText }}>
                Disconnect
              </button>

              {/* Verify button is shown only when not yet verified */}
              {!isVerified ? (
                <button onClick={handleVerifyClick} style={{ ...styles.verifyBtn, background: tokens.btnPrimaryBg, border: tokens.btnPrimaryBorder, color: tokens.btnPrimaryText }}>
                  Verify (Sign)
                </button>
              ) : (
                <>
                  <span style={styles.verifiedBadge}>Verified</span>
                  {localManifestCid && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      {isUpToDate ? (
                        <span style={{ ...styles.verifiedBadge, background: tokens.ok + '22', color: tokens.ok }}>Up to date</span>
                      ) : (
                        <button 
                          onClick={async () => {
                            setPublishing(true)
                            setError(null)
                            try {
                              await publishManifest(localManifestCid)
                            } catch (err: any) {
                              setError(err?.message ?? String(err))
                            } finally {
                              setPublishing(false)
                            }
                          }} 
                          disabled={publishing}
                          style={{ ...styles.verifyBtn, background: tokens.btnPrimaryBg, border: tokens.btnPrimaryBorder, color: tokens.btnPrimaryText }}
                        >
                          {publishing ? 'Publishing...' : 'Publish to Solana'}
                        </button>
                      )}
                    </div>
                  )}
                </>
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
  // visual attributes (colors/backgrounds) are applied at render time using shared theme tokens
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 8,
    // border/background will be provided by theme merge at render
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
    // visual styles applied inline with tokens
  },
  controls: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  connectBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    // colors applied at usage site
  },
  disconnectBtn: {
    padding: '6px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    // colors applied at usage site
  },
  verifyBtn: {
    padding: '6px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    // colors applied at usage site
  },
  verifiedBadge: {
    padding: '6px 10px',
    borderRadius: 8,
    fontSize: 13,
    // visual appearance controlled by theme tokens at render
  },
  installLink: {
    marginLeft: 8,
    fontSize: 13,
    textDecoration: 'none',
  },
  note: {
    fontSize: 12,
  },
  error: {
    fontSize: 13,
    // error colors applied inline using tokens when rendering
  },
}

export default ConnectWallet
