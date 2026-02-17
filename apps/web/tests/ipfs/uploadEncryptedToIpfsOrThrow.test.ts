import { describe, it, expect, vi } from 'vitest'

import {
  MAX_MVP_FILE_BYTES,
  uploadEncryptedToIpfsOrThrow,
} from '../../src/lib/ipfs/uploadEncryptedToIpfs'

function makeFileLike(content: string, name = 'demo.txt', type = 'text/plain'): File {
  const bytes = new TextEncoder().encode(content)
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File
}

describe('uploadEncryptedToIpfsOrThrow', () => {
  it('blocks upload when guards are not satisfied', async () => {
    const file = makeFileLike('secret')

    const deps = {
      loadIdentity: vi.fn(() => ({ signature: 'sig-b58', expiresAt: '2099-01-01T00:00:00.000Z' } as any)),
      canPerformVaultActions: vi.fn(() => false),
      decodeSignature: vi.fn(),
      buildUnlockMessageV1: vi.fn(),
      deriveKekFromUnlockSignature: vi.fn(),
      encryptFile: vi.fn(),
      sha256: vi.fn(),
      addEncryptedPackage: vi.fn(),
      randomBytes: vi.fn(() => new Uint8Array(32)),
      nowMs: vi.fn(() => Date.parse('2026-01-01T00:00:00.000Z')),
      origin: vi.fn(() => 'http://localhost:1620'),
    }

    await expect(uploadEncryptedToIpfsOrThrow(file, 'wallet-pubkey', deps)).rejects.toThrow(
      'Upload denied — Verify identity and Unlock Vault before uploading files.'
    )

    expect(deps.addEncryptedPackage).not.toHaveBeenCalled()
    expect(deps.encryptFile).not.toHaveBeenCalled()
  })

  it('blocks files larger than 100MB', async () => {
    const tooLarge = {
      name: 'big.bin',
      type: 'application/octet-stream',
      size: MAX_MVP_FILE_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as File

    const deps = {
      loadIdentity: vi.fn(() => ({ signature: 'sig-b58', expiresAt: '2099-01-01T00:00:00.000Z' } as any)),
      canPerformVaultActions: vi.fn(() => true),
      decodeSignature: vi.fn(),
      buildUnlockMessageV1: vi.fn(),
      deriveKekFromUnlockSignature: vi.fn(),
      encryptFile: vi.fn(),
      sha256: vi.fn(),
      addEncryptedPackage: vi.fn(),
      randomBytes: vi.fn(() => new Uint8Array(32)),
      nowMs: vi.fn(() => Date.parse('2026-01-01T00:00:00.000Z')),
      origin: vi.fn(() => 'http://localhost:1620'),
    }

    await expect(uploadEncryptedToIpfsOrThrow(tooLarge, 'wallet-pubkey', deps)).rejects.toThrow(
      'Fichier trop volumineux (max 100MB pour le MVP).'
    )

    expect(deps.addEncryptedPackage).not.toHaveBeenCalled()
    expect(deps.encryptFile).not.toHaveBeenCalled()
  })

  it('builds SHA-256 on hash basis, sets header=encryptedFile and uploads encrypted object', async () => {
    const file = makeFileLike('plaintext should never reach ipfs', 'hello.txt', 'text/plain')

    const encryptedFile = {
      version: 1,
      cipher: 'XChaCha20-Poly1305',
      nonce: 'nonce-b64',
      ciphertext: 'ciphertext-b64',
      fileId: 'file-id-1',
      originalFileName: 'hello.txt',
      mimeType: 'text/plain',
      fileSize: file.size,
    }

    const envelope = {
      version: 1,
      walletPubKey: 'wallet-pubkey',
      kekDerivation: {
        method: 'wallet-signature',
        messageTemplateId: 'SJ_UNLOCK_V1',
        salt: 'salt-b64',
      },
      wrap: {
        cipher: 'XChaCha20-Poly1305',
        nonce: 'wrap-nonce-b64',
        ciphertext: 'wrap-ciphertext-b64',
      },
    }

    const expectedHash = new Uint8Array([1, 2, 3, 4])
    const addEncryptedPackage = vi.fn(async () => ({ cid: 'bafy-test-cid' }))

    const deps = {
      loadIdentity: vi.fn(() => ({ signature: 'sig-b58', expiresAt: '2099-01-01T00:00:00.000Z' } as any)),
      canPerformVaultActions: vi.fn(() => true),
      decodeSignature: vi.fn(() => new Uint8Array([11, 22, 33])),
      buildUnlockMessageV1: vi.fn(async () => ({
        canonicalObject: {
          sj: 'SovereignJedi',
          ver: '1',
          type: 'UNLOCK',
          origin: 'http://localhost:1620',
          wallet: 'wallet-pubkey',
          nonce: 'nonce-b64',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          vaultId: 'local-default',
        },
        messageToSign: 'SJ_UNLOCK_V1\\n{"wallet":"wallet-pubkey"}',
      })),
      deriveKekFromUnlockSignature: vi.fn(async () => new Uint8Array(32).fill(9)),
      encryptFile: vi.fn(async () => ({ encryptedFile, envelope })),
      sha256: vi.fn(async () => expectedHash),
      addEncryptedPackage,
      randomBytes: vi.fn(() => new Uint8Array(32).fill(7)),
      nowMs: vi.fn(() => Date.parse('2026-01-01T00:00:00.000Z')),
      origin: vi.fn(() => 'http://localhost:1620'),
    }

    const result = await uploadEncryptedToIpfsOrThrow(file, 'wallet-pubkey', deps)

    expect(result.cid).toBe('bafy-test-cid')
    expect(result.integritySha256B64).toBe('AQIDBA==')

    expect(deps.sha256).toHaveBeenCalledTimes(1)
    const basisBytes = deps.sha256.mock.calls[0][0] as Uint8Array
    const basisJson = new TextDecoder().decode(basisBytes)
    expect(basisJson).toContain('"header":{"version":1')
    expect(basisJson).toContain('"payload":{"ciphertextB64":"ciphertext-b64"}')
    expect(basisJson).not.toContain('integrity')

    expect(addEncryptedPackage).toHaveBeenCalledTimes(1)
    const uploadedObject = addEncryptedPackage.mock.calls[0][0]
    expect(uploadedObject.header).toEqual(encryptedFile)
    expect(uploadedObject.payload.ciphertextB64).toBe(encryptedFile.ciphertext)
    expect(uploadedObject.integrity.sha256B64).toBe('AQIDBA==')

    const uploadedJson = JSON.stringify(uploadedObject)
    expect(uploadedJson).not.toContain('plaintext should never reach ipfs')
  })
})
