import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as nacl from 'tweetnacl'
import bs58 from 'bs58'

import { session } from '../SessionManager'
import { canPerformVaultActions } from '../vaultGuards'
import type { Identity } from '../../../components/wallet/types'

function makeIdentity(options?: { valid?: boolean; ttlSeconds?: number }): Identity {
  const now = new Date()
  const verifiedAt = now.toISOString()
  const ttl = options?.ttlSeconds ?? 24 * 60 * 60
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString()
  const nonce = 'testnonce' // deterministic for unit tests

  if (options?.valid === false) {
    // expired identity
    const past = new Date(now.getTime() - 1000 * 60 * 60)
    return {
      publicKey: 'FAKE',
      message: 'm',
      signature: 's',
      issuedAt: past.toISOString(),
      verifiedAt: past.toISOString(),
      expiresAt: past.toISOString(),
      nonce,
      cluster: 'devnet',
      domain: 'localhost',
    }
  }

  // valid identity
  return {
    publicKey: 'FAKE_PUBKEY', // not used for crypto here, only shape & expiry matter
    message: 'm',
    signature: 's',
    issuedAt: verifiedAt,
    verifiedAt,
    expiresAt,
    nonce,
    cluster: 'devnet',
    domain: 'localhost',
  }
}

describe('vaultGuards — combined IdentityVerified && VaultUnlocked', () => {
  // ensure clean session for every test
  beforeEach(() => {
    try {
      session.disconnectWallet()
    } catch {
      // ignore
    }
  })

  afterEach(() => {
    try {
      session.disconnectWallet()
    } catch {
      // ignore
    }
  })

  it('rejects upload when verified=false and unlocked=true', async () => {
    // prepare: session unlocked (simulate unlock via signer)
    const kp = nacl.sign.keyPair()
    const pubBase58 = bs58.encode(kp.publicKey)
    // register wallet in session
    await session.connectWallet(pubBase58, 'phantom')
    // inject signer that uses the keypair to sign the dynamic message
    session.setSigner(async (msg) => nacl.sign.detached(msg, kp.secretKey))
    // unlock vault
    await session.unlockVault()
    expect(session.isVaultUnlocked()).toBe(true)

    // identity not verified (expired)
    const identity = makeIdentity({ valid: false })

    const allowed = canPerformVaultActions(identity)
    expect(allowed).toBe(false)
  })

  it('rejects upload when verified=true and locked=true', async () => {
    // valid identity
    const identity = makeIdentity({ valid: true })

    // ensure session locked
    await session.disconnectWallet()
    session.lockVault()
    expect(session.isVaultUnlocked()).toBe(false)

    const allowed = canPerformVaultActions(identity)
    expect(allowed).toBe(false)
  })

  it('allows upload when verified=true and unlocked=true', async () => {
    // prepare identity verified
    const identity = makeIdentity({ valid: true })

    // prepare unlocked session via signer flow
    const kp = nacl.sign.keyPair()
    const pubBase58 = bs58.encode(kp.publicKey)
    await session.connectWallet(pubBase58, 'phantom')
    session.setSigner(async (msg) => nacl.sign.detached(msg, kp.secretKey))
    await session.unlockVault()
    expect(session.isVaultUnlocked()).toBe(true)

    const allowed = canPerformVaultActions(identity)
    expect(allowed).toBe(true)
  })
})
