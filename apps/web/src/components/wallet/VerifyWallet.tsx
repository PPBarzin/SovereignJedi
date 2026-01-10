'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import {
  buildProofMessage,
  computeExpiresAt,
  generateNonce,
  getProofTtlSeconds,
  Identity,
  STORAGE_KEY_IDENTITY,
  truncateAddress,
  saveIdentity,
} from './types'
import {
  signatureToBase58,
  verifyMessageSignatureVerbose,
  messageToBytes,
} from './utils'

type Props = {
  /**
   * The currently connected public key (base58) provided by ConnectWallet or the app.
   * If nullish, the component will render a disabled state.
   */
  publicKey?: string | null
  /**
   * Optional callback called when verification succeeds.
   */
  onVerified?: (identity: Identity) => void
  /**
   * Optional override for cluster (devnet/mainnet-beta). Defaults to NEXT_PUBLIC_SOLANA_CLUSTER or 'devnet'.
   */
  clusterOverride?: string
}

/**
 * VerifyWallet component
 *
 * Responsibilities:
 * - Build a deterministic proof-of-control message.
 * - Request the wallet to sign the message (via wallet-adapter or window.solana fallback).
 * - Verify the signature locally.
 * - Persist a minimal identity object to localStorage (see Task 3 spec).
 * - Expose verification status and errors to the parent via callbacks and UI.
 *
 * Notes:
 * - This component performs only local verification. No backend involvement.
 * - The signature is persisted as base58.
 */
export const VerifyWallet: FC<Props> = ({ publicKey, onVerified, clusterOverride }) => {
  const wallet = useWallet()

  // Effective public key resolution:
  // - Prefer an explicit `publicKey` prop (base58 string).
  // - Fallback to the connected wallet adapter's `wallet.publicKey.toBase58()` if available.
  // - Results in `string | null` so the component can render a disabled state when absent.
  const effectivePublicKey = useMemo(() => {
    try {
      if (publicKey) return publicKey
      if (wallet && (wallet as any).publicKey && typeof (wallet as any).publicKey.toBase58 === 'function') {
        return (wallet as any).publicKey.toBase58()
      }
    } catch {
      // ignore and fallthrough to null
    }
    return null
  }, [publicKey, wallet])

  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastIdentity, setLastIdentity] = useState<Identity | null>(null)
  const [domain, setDomain] = useState<string>(() => {
    if (typeof window !== 'undefined' && process?.env?.NEXT_PUBLIC_APP_DOMAIN) {
      return process.env.NEXT_PUBLIC_APP_DOMAIN
    }
    if (typeof window !== 'undefined') return window.location.host
    return 'localhost'
  })

  const cluster = useMemo(() => {
    if (clusterOverride) return clusterOverride
    if (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SOLANA_CLUSTER) {
      return process.env.NEXT_PUBLIC_SOLANA_CLUSTER
    }
    return 'devnet'
  }, [clusterOverride])

  useEffect(() => {
    // Load any saved identity from localStorage (best-effort)
    try {
      if (typeof window === 'undefined') return
      const raw = window.localStorage.getItem(STORAGE_KEY_IDENTITY)
      if (!raw) {
        setLastIdentity(null)
        return
      }
      const parsed = JSON.parse(raw) as Identity
      setLastIdentity(parsed)
    } catch {
      setLastIdentity(null)
    }
  }, [])

  const buildMessage = useCallback(
    (pubKey: string, nonce: string, issuedAtIso: string) => {
      return buildProofMessage({
        domain,
        publicKey: pubKey,
        nonce,
        issuedAt: issuedAtIso,
        cluster,
      })
    },
    [domain, cluster]
  )

  const doVerify = useCallback(
    async (opts?: { forceNewNonce?: boolean }) => {
      setError(null)
      if (!effectivePublicKey) {
        setError('No public key available. Connect a wallet first.')
        return
      }

      setVerifying(true)
      try {
        const nonce = generateNonce(24)
        const issuedAt = new Date().toISOString()
        const message = buildMessage(effectivePublicKey as string, nonce, issuedAt)

        // message bytes for signing
        const messageBytes = messageToBytes(message)

        // Candidate signers:
        // 1) wallet adapter if it provides `signMessage`
        // 2) window.solana.signMessage (Phantom) fallback
        let signatureBytes: Uint8Array | null = null
        try {
          // Prefer adapter method
          // Some wallet-adapter implementations expose `signMessage` on the wallet object
          // which takes a Uint8Array and returns Uint8Array.
          // We guard calls to not assume types.
          if (wallet && (wallet as any).signMessage) {
            // @ts-ignore
            const signed = await (wallet as any).signMessage(messageBytes)
            if (signed && signed.signature) {
              // some adapters return { signature, publicKey } shape
              signatureBytes = signed.signature instanceof Uint8Array ? signed.signature : new Uint8Array(signed.signature)
            } else if (signed instanceof Uint8Array) {
              signatureBytes = signed
            } else if (signed && signed?.signature?.data) {
              signatureBytes = new Uint8Array(signed.signature.data)
            }
          }
        } catch (e) {
          // ignore and fallback
        }

        if (!signatureBytes) {
          // fallback to Phantom extension API
          if (typeof window !== 'undefined') {
            const sol = (window as any).solana
            if (sol && sol.signMessage) {
              // Phantom takes { message: Uint8Array, display?: 'utf8' } in some versions
              // but commonly supports sol.signMessage(uint8array)
              const res = await sol.signMessage(messageBytes, 'utf8')
              if (res && res.signature) {
                signatureBytes = res.signature instanceof Uint8Array ? res.signature : new Uint8Array(res.signature)
              } else if (res instanceof Uint8Array) {
                signatureBytes = res
              }
            }
          }
        }

        if (!signatureBytes) {
          // As a last attempt, some adapters expose signMessage returning a base58 string:
          // try wallet.signMessage with the message and handle a string result.
          try {
            if (wallet && (wallet as any).signMessage) {
              const maybe = await (wallet as any).signMessage(messageBytes)
              if (typeof maybe === 'string') {
                // convert base58/hex/base64 to bytes via utils.decode in utils.ts (we don't export decode, so convert using bs58 here)
                // But to avoid adding new deps here, convert via signatureToBase58 when storing; we expect verify util accepts string too.
                signatureBytes = new Uint8Array(Buffer.from(maybe, 'base64'))
              }
            }
          } catch {
            // ignore
          }
        }

        if (!signatureBytes) {
          setError('Unable to obtain signature from wallet (user rejected or unsupported).')
          setVerifying(false)
          return
        }

        // Convert signature bytes to a stable base58 string for storage
        const signatureBase58 = signatureToBase58(signatureBytes)

        // Verify locally
        const verification = verifyMessageSignatureVerbose(message, signatureBytes, effectivePublicKey as string)
        if (!verification.ok) {
          setError(`Signature verification failed: ${verification.reason ?? 'unknown'}`)
          setVerifying(false)
          return
        }

        // Build identity and persist
        const verifiedAt = new Date().toISOString()
        const ttl = getProofTtlSeconds()
        const expiresAt = computeExpiresAt(verifiedAt, ttl)

        const identity: Identity = {
          publicKey: effectivePublicKey as string,
          message,
          signature: signatureBase58,
          issuedAt,
          verifiedAt,
          expiresAt,
          nonce,
          cluster,
          domain,
        }

        try {
          saveIdentity(identity)
          // also set in-memory
          setLastIdentity(identity)
        } catch {
          // ignore localStorage errors but surface to user minimally
        }

        // Callback to parent
        if (onVerified) {
          try {
            onVerified(identity)
          } catch {
            // ignore
          }
        }
      } catch (err: any) {
        setError(err?.message ?? String(err))
      } finally {
        setVerifying(false)
      }
    },
    [publicKey, wallet, buildMessage, onVerified]
  )

  // UX helpers
  const verified = useMemo(() => {
    if (!lastIdentity) return false
    try {
      const now = new Date()
      const exp = Date.parse(lastIdentity.expiresAt)
      if (Number.isNaN(exp)) return false
      return now.getTime() <= exp
    } catch {
      return false
    }
  }, [lastIdentity])

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <div>
          <div style={labelStyle}>Proof-of-control</div>
          <div style={descStyle}>
            Sign a free, non-transactional message to prove ownership of the connected wallet.
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>Wallet:</strong>{' '}
            <span style={{ fontFamily: 'monospace' }}>{effectivePublicKey ? truncateAddress(effectivePublicKey) : '—'}</span>
          </div>
        </div>

        <div style={controlsStyle}>
          <button
            onClick={() => void doVerify()}
            disabled={!effectivePublicKey || verifying}
            style={{
              ...buttonStyle,
              background: effectivePublicKey ? '#0a8' : '#ddd',
              cursor: !effectivePublicKey || verifying ? 'not-allowed' : 'pointer',
            }}
            aria-disabled={!effectivePublicKey || verifying}
          >
            {verifying ? 'Verifying…' : 'Sign to Verify'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {lastIdentity ? (
          <div style={identityBoxStyle}>
            <div>
              <strong>Status:</strong>{' '}
              <span style={{ color: verified ? '#046' : '#b66' }}>
                {verified ? 'Verified' : 'Connected (not verified / expired)'}
              </span>
            </div>
            <div style={{ marginTop: 6 }}>
              <small>Verified at: {lastIdentity.verifiedAt}</small>
            </div>
            <div>
              <small>Expires at: {lastIdentity.expiresAt}</small>
            </div>
            <div style={{ marginTop: 6 }}>
              <small>Nonce: {lastIdentity.nonce.slice(0, 12)}…</small>
            </div>
          </div>
        ) : (
          <div style={hintStyle}>No verification present. Click "Sign to Verify" after connecting your wallet.</div>
        )}
      </div>

      {error && <div style={errorStyle}>Error: {error}</div>}
    </div>
  )
}

export default VerifyWallet

/* Styles - unified dark/bluish card style to match IdentityStatus and overall dark theme */
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.04)',
  background: '#07182b', // slightly lighter than page background for contrast
  color: '#e6f6ff',
  fontSize: 13,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#dff6ff',
}

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#b9cfe0',
}

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
}

/* Button base: neutral dark-themed button; primary action styles are applied inline where needed */
const buttonStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'transparent',
  color: '#dff6ff',
  fontWeight: 700,
}

/* Identity panel inside the card - slightly lighter bluish panel */
const identityBoxStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.03)',
  padding: 10,
  borderRadius: 8,
  background: '#0b2a42', // soft bluish card for inner meta area
  fontSize: 13,
  color: '#e6f6ff',
}

const hintStyle: React.CSSProperties = {
  color: '#9fbfd6',
  fontSize: 13,
}

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  color: '#ffb3b3',
  background: 'rgba(255,40,40,0.06)',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 13,
}
