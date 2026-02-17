import type { EncryptedIpfsObjectV1, EncryptedIpfsObjectV1HashBasis } from '@sj/ipfs'

import { buildUnlockMessageV1, deriveKekFromUnlockSignature, encryptFile, sha256 } from '@sj/crypto'
import type { BuildUnlockResult, EncryptedFile } from '@sj/crypto'
import { loadIdentity } from '../../components/wallet/types'
import { decodeSignature } from '../../components/wallet/utils'
import { canPerformVaultActions } from '../session/vaultGuards'

const SJ_DEBUG = process.env.NEXT_PUBLIC_SJ_DEBUG === "true"

export const MAX_MVP_FILE_BYTES = 100 * 1024 * 1024

export type UploadEncryptedToIpfsResult = {
  cid: string
  integritySha256B64: string
  object: EncryptedIpfsObjectV1
}

type EncryptedFileLike = EncryptedFile
type EnvelopeLike = Record<string, any>
type UnlockLike = BuildUnlockResult

type Deps = {
  loadIdentity: typeof loadIdentity
  canPerformVaultActions: typeof canPerformVaultActions
  decodeSignature: typeof decodeSignature
  buildUnlockMessageV1: (params: {
    origin?: string
    wallet: string
    vaultId?: string
    issuedAt?: string
    expiresAt?: string
  }) => Promise<UnlockLike>
  deriveKekFromUnlockSignature: (params: {
    signatureBytes: Uint8Array
    saltBytes: Uint8Array | null
    unlock: UnlockLike
    nowMs?: number
  }) => Promise<Uint8Array>
  encryptFile: (
    plaintext: Uint8Array,
    options: {
      fileKey?: Uint8Array
      kek: Uint8Array
      salt: Uint8Array
      walletPubKey: string
      fileId?: string
      filename?: string
      mimeType?: string
    }
  ) => Promise<{
    encryptedFile: EncryptedFileLike
    envelope: EnvelopeLike
    fileKey?: Uint8Array
  }>
  sha256: (data: Uint8Array | ArrayBuffer) => Promise<Uint8Array>
  addEncryptedPackage: (pkg: EncryptedIpfsObjectV1) => Promise<{ cid: string }>
  randomBytes: (len?: number) => Uint8Array
  nowMs: () => number
  origin: () => string
}

function randomBytesFallback(len = 32): Uint8Array {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(len))
  }
  throw new Error('No secure random source available')
}

const defaultDeps: Deps = {
  loadIdentity,
  canPerformVaultActions,
  decodeSignature,
  buildUnlockMessageV1: async (params) => {
    return buildUnlockMessageV1(params)
  },
  deriveKekFromUnlockSignature: async (params) => {
    return deriveKekFromUnlockSignature(params)
  },
  encryptFile: async (plaintext, options) => {
    return encryptFile(plaintext, options)
  },
  sha256: async (data) => {
    return sha256(data)
  },
  addEncryptedPackage: async (pkg) => {
    const mod = await import('@sj/ipfs')
    return mod.addEncryptedPackage(pkg)
  },
  randomBytes: randomBytesFallback,
  nowMs: () => Date.now(),
  origin: () => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function serializeToBytes(input: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input))
}

export function buildEncryptedIpfsObjectV1(params: {
  encryptedFile: EncryptedFileLike
  envelope: EnvelopeLike
  integritySha256B64: string
}): EncryptedIpfsObjectV1 {
  return {
    version: 1,
    header: params.encryptedFile,
    envelope: params.envelope,
    payload: {
      ciphertextB64: params.encryptedFile.ciphertext,
    },
    integrity: {
      sha256B64: params.integritySha256B64,
    },
  }
}

export async function uploadEncryptedToIpfsOrThrow(
  file: File,
  walletPubKey: string,
  injectedDeps: Partial<Deps> = {}
): Promise<UploadEncryptedToIpfsResult> {
  const deps: Deps = { ...defaultDeps, ...injectedDeps }

  if (SJ_DEBUG) {
    console.debug('[IPFS:UI] upload start')
  }

  if (!walletPubKey || walletPubKey.trim().length === 0) {
    throw new Error('Wallet non connecté.')
  }

  const identity = deps.loadIdentity()

  if (!deps.canPerformVaultActions(identity)) {
    throw new Error('Upload denied — Verify identity and Unlock Vault before uploading files.')
  }

  if (file.size > MAX_MVP_FILE_BYTES) {
    throw new Error('Fichier trop volumineux (max 100MB pour le MVP).')
  }

  const signature = identity?.signature
  if (!signature) {
    throw new Error('Signature de preuve introuvable. Re-vérifie ton wallet.')
  }

  const signatureBytes = deps.decodeSignature(signature)
  const salt = deps.randomBytes(32)

  const nowMs = deps.nowMs()
  const issuedAt = new Date(nowMs).toISOString()
  const expiresAt = identity?.expiresAt ?? new Date(nowMs + 10 * 60 * 1000).toISOString()

  const unlock = await deps.buildUnlockMessageV1({
    origin: deps.origin(),
    wallet: walletPubKey,
    vaultId: 'local-default',
    issuedAt,
    expiresAt,
  })

  const kek = await deps.deriveKekFromUnlockSignature({
    signatureBytes,
    saltBytes: salt,
    unlock,
    nowMs,
  })

  const plaintext = new Uint8Array(await file.arrayBuffer())


  const { encryptedFile, envelope } = await deps.encryptFile(plaintext, {
    kek,
    salt,
    walletPubKey,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
  })


  const hashBasis: EncryptedIpfsObjectV1HashBasis = {
    version: 1,
    header: encryptedFile,
    envelope,
    payload: {
      ciphertextB64: encryptedFile.ciphertext,
    },
  }

  const basisBytes = serializeToBytes(hashBasis)
  const hash = await deps.sha256(basisBytes)
  const sha256B64 = toBase64(hash)

  const object = buildEncryptedIpfsObjectV1({
    encryptedFile,
    envelope,
    integritySha256B64: sha256B64,
  })

  const { cid } = await deps.addEncryptedPackage(object)
  if (SJ_DEBUG) {
    console.debug('[IPFS:UI] upload ok', { cid })
  }

  return {
    cid,
    integritySha256B64: sha256B64,
    object,
  }
}
