import { describe, it, expect } from 'vitest'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

import {
  buildProofMessage,
  generateNonce,
  computeExpiresAt,
  isIdentityExpired,
} from '../src/components/wallet/types'

import {
  messageToBytes,
  signatureToBase58,
  verifyMessageSignature,
  verifyMessageSignatureVerbose,
} from '../src/components/wallet/utils'

describe('wallet utils & types', () => {
  it('buildProofMessage produces stable, readable message with required fields in order', () => {
    const domain = 'localhost:1620'
    const publicKey = 'ABCD1234'
    const nonce = 'deadbeef'
    const issuedAt = '2026-01-10T09:00:00Z'
    const cluster = 'devnet'

    const msg = buildProofMessage({
      domain,
      publicKey,
      nonce,
      issuedAt,
      cluster,
    })

    // Ensure lines exist and are in expected order
    const expectedLines = [
      'Sovereign Jedi — Proof of Control',
      `domain: ${domain}`,
      `publicKey: ${publicKey}`,
      'statement: Prove you control this wallet for Sovereign Jedi',
      `nonce: ${nonce}`,
      `issuedAt: ${issuedAt}`,
      `chain: solana:${cluster}`,
      'purpose: proof_of_control',
    ]

    const msgLines = msg.split('\n').map((l) => l.trim())
    expect(msgLines).toEqual(expectedLines)
  })

  it('generateNonce returns a hex string of expected length and uniqueness', () => {
    const n1 = generateNonce(16) // 16 bytes -> 32 hex chars
    const n2 = generateNonce(16)
    expect(typeof n1).toBe('string')
    expect(n1.length).toBe(32)
    expect(n2.length).toBe(32)
    expect(n1).not.toBe(n2) // very likely different
  })

  it('computeExpiresAt adds TTL seconds to verifiedAt', () => {
    const verifiedAt = '2026-01-01T00:00:00.000Z'
    const ttl = 60 // 1 minute
    const expires = computeExpiresAt(verifiedAt, ttl)
    expect(new Date(expires).toISOString()).toBe('2026-01-01T00:01:00.000Z')
  })

  it('isIdentityExpired returns true for past expiry and false for future expiry', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const pastIdentity = {
      publicKey: 'A',
      message: 'm',
      signature: 's',
      issuedAt: '2025-12-31T23:00:00.000Z',
      verifiedAt: '2025-12-31T23:00:00.000Z',
      expiresAt: '2025-12-31T23:30:00.000Z',
      nonce: 'n',
      cluster: 'devnet',
      domain: 'localhost',
    }
    const futureIdentity = {
      ...pastIdentity,
      expiresAt: '2026-02-01T00:00:00.000Z',
    }

    expect(isIdentityExpired(pastIdentity, now)).toBe(true)
    expect(isIdentityExpired(futureIdentity, now)).toBe(false)
  })

  it('can sign and verify a proof message (ed25519) using utils', () => {
    // Create a random ed25519 keypair
    const kp = nacl.sign.keyPair()
    const pubBytes = kp.publicKey // Uint8Array(32)
    const secretKey = kp.secretKey // Uint8Array(64)

    const pubBase58 = bs58.encode(pubBytes)

    const domain = 'localhost:1620'
    const nonce = 'abcd1234'
    const issuedAt = new Date().toISOString()
    const cluster = 'devnet'

    // Build the message to sign (same format as buildProofMessage)
    const msg = buildProofMessage({
      domain,
      publicKey: pubBase58,
      nonce,
      issuedAt,
      cluster,
    })

    const msgBytes = messageToBytes(msg)

    // Sign the message with the secret key
    const signature = nacl.sign.detached(msgBytes, secretKey)

    // Convert signature to base58 (storage format used by utils)
    const signatureB58 = signatureToBase58(signature)

    // Verify signature (should be true)
    const ok = verifyMessageSignature(msg, signatureB58, pubBase58)
    expect(ok).toBe(true)

    // Also test verbose verifier
    const verbose = verifyMessageSignatureVerbose(msg, signatureB58, pubBase58)
    expect(verbose.ok).toBe(true)
    expect(verbose.reason).toBeUndefined()
  })

  it('verifyMessageSignature fails for tampered message or signature', () => {
    const kp = nacl.sign.keyPair()
    const pubBase58 = bs58.encode(kp.publicKey)
    const cluster = 'devnet'
    const msg = buildProofMessage({
      domain: 'localhost',
      publicKey: pubBase58,
      nonce: 'xyz',
      issuedAt: new Date().toISOString(),
      cluster,
    })
    const msgBytes = messageToBytes(msg)
    const sig = nacl.sign.detached(msgBytes, kp.secretKey)
    const sigB58 = signatureToBase58(sig)

    // Tamper message
    const tampered = msg + '\nextra: tamper'
    const okTampered = verifyMessageSignature(tampered, sigB58, pubBase58)
    expect(okTampered).toBe(false)

    // Tamper signature (flip a bit)
    const badSig = new Uint8Array(sig)
    badSig[0] = (badSig[0] + 1) & 0xff
    const badSigB58 = signatureToBase58(badSig)
    const okBadSig = verifyMessageSignature(msg, badSigB58, pubBase58)
    expect(okBadSig).toBe(false)
  })
})
