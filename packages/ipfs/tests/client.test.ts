import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const addBytesSpy = vi.fn(async (_bytes: Uint8Array) => ({ toString: () => 'bafy-mocked-cid' }))
const createLibp2pSpy = vi.fn(async () => ({ id: 'libp2p-mock' }))

vi.mock('helia', () => ({
  createHelia: vi.fn(async () => ({ helia: true })),
}), { virtual: true })

vi.mock('@helia/unixfs', () => ({
  unixfs: vi.fn(() => ({ addBytes: addBytesSpy })),
}), { virtual: true })

vi.mock('multiformats/cid', () => ({
  CID: class CIDMock {},
}), { virtual: true })

vi.mock('@multiformats/multiaddr', () => ({
  multiaddr: vi.fn((input: string) => ({ toString: () => input })),
}), { virtual: true })

vi.mock('libp2p', () => ({
  createLibp2p: createLibp2pSpy,
}), { virtual: true })

vi.mock('@libp2p/websockets', () => ({
  webSockets: vi.fn(() => ({ name: 'websockets-mock' })),
}), { virtual: true })

vi.mock('@chainsafe/libp2p-noise', () => ({
  noise: vi.fn(() => ({ name: 'noise-mock' })),
}), { virtual: true })

vi.mock('@chainsafe/libp2p-yamux', () => ({
  yamux: vi.fn(() => ({ name: 'yamux-mock' })),
}), { virtual: true })

vi.mock('@libp2p/bootstrap', () => ({
  bootstrap: vi.fn((params: any) => ({
    name: 'bootstrap-mock',
    params,
  })),
}), { virtual: true })

describe('@sj/ipfs client', () => {
  beforeEach(() => {
    vi.resetModules()
    addBytesSpy.mockClear()
    createLibp2pSpy.mockClear()
    fetchMock.mockReset()
    delete process.env.NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS
    delete process.env.NEXT_PUBLIC_IPFS_KUBO_API

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"Name":"payload.bin","Hash":"bafy-kubo-cid","Size":"123"}\n',
    })

    // @ts-ignore - test runtime inject
    globalThis.fetch = fetchMock
  })

  it('does not emit logs when debug disabled', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mod = await import('../src/client')
    mod.resetIpfsContextForTests()

    await mod.addBytes(new Uint8Array([1, 2, 3]))

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    debugSpy.mockRestore()
    infoSpy.mockRestore()
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('uses Kubo HTTP add by default and returns CID', async () => {
    const mod = await import('../src/client')
    mod.resetIpfsContextForTests()

    const result = await mod.addBytes(new Uint8Array([1, 2, 3]))

    expect(result).toEqual({ cid: 'bafy-kubo-cid', size: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('addEncryptedPackage serializes full object and returns CID', async () => {
    const mod = await import('../src/client')
    mod.resetIpfsContextForTests()

    const pkg = {
      version: 1 as const,
      header: {
        version: 1,
        cipher: 'XChaCha20-Poly1305',
        nonce: 'nonce-b64',
        ciphertext: 'ciphertext-b64',
      },
      envelope: {
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
      },
      payload: {
        ciphertextB64: 'ciphertext-b64',
      },
      integrity: {
        sha256B64: 'hash-b64',
      },
    }

    const result = await mod.addEncryptedPackage(pkg)

    expect(result).toEqual({ cid: 'bafy-kubo-cid' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(addBytesSpy).toHaveBeenCalledTimes(0)
  })

  it('parses CSV bootstrap multiaddrs from explicit config', async () => {
    process.env.NEXT_PUBLIC_IPFS_KUBO_API = ''

    const mod = await import('../src/client')
    mod.resetIpfsContextForTests()

    await mod.addBytes(new Uint8Array([9, 9, 9]), {
      bootstrapMultiaddrs:
        '/ip4/127.0.0.1/tcp/15002/ws/p2p/PEER_ID_A, /ip4/127.0.0.1/tcp/15003/ws/p2p/PEER_ID_B',
    })

    expect(createLibp2pSpy).toHaveBeenCalledTimes(1)
    const libp2pConfig = createLibp2pSpy.mock.calls[0][0]
    const discovery = libp2pConfig.peerDiscovery[0]

    expect(discovery.params.list).toEqual([
      '/ip4/127.0.0.1/tcp/15002/ws/p2p/PEER_ID_A',
      '/ip4/127.0.0.1/tcp/15003/ws/p2p/PEER_ID_B',
    ])
  })
})
