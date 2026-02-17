/**
 * @sj/ipfs — client abstraction (Task 5)
 *
 * Goals:
 * - Provide a small, UI-safe API surface:
 *     - addBytes(bytes) -> { cid, size }
 *     - addEncryptedPackage(pkg) -> { cid }
 * - Use Helia (IPFS in-browser) with deterministic dev connectivity:
 *     - WebSockets transport
 *     - Bootstrap/relay via a local libp2p node
 *     - Config from NEXT_PUBLIC_IPFS_BOOTSTRAP_MULTIADDRS (CSV)
 * - Local-only: no CDN, no dynamic script injection.
 *
 * IMPORTANT:
 * - This module MUST NOT handle plaintext. It only deals with encrypted bytes / encrypted JSON objects.
 * - Upload gating (Verified && VaultUnlocked) is enforced by the app layer, not here.
 * - No secret persistence. This module holds no secrets.
 *
 * Notes:
 * - Helia/libp2p config is intentionally minimal for MVP. The objective is reproducibility on the dev machine.
 * - If bootstrap multiaddrs are missing, we throw explicitly (per decision).
 */

import { createHelia, type Helia } from 'helia'
import { unixfs, type UnixFS } from '@helia/unixfs'
import { CID } from 'multiformats/cid'
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr'
import { createLibp2p, type Libp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'

import type {
  AddBytesResult,
  AddEncryptedPackageResult,
  EncryptedIpfsObjectV1,
  IpfsClientConfig,
} from './types'

/* -------------------------
 * Env / config helpers
 * ------------------------- */

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const html = document.documentElement
  const jsonAttr = html.getAttribute('data-sj-config-json')
  if (jsonAttr) {
    try {
      const parsed = JSON.parse(jsonAttr)
      if (typeof parsed?.debug === 'boolean') return parsed.debug
      if (typeof parsed?.debug === 'string') return parsed.debug === 'true'
    } catch {
      // ignore invalid JSON
    }
  }
  const attr = html.getAttribute('data-sj-debug')
  if (attr != null) return String(attr).toLowerCase() === 'true'
  return false
}

function debugLog(message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  if (data) {
    console.debug(message, data)
  } else {
    console.debug(message)
  }
}

function parseCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

const DEFAULT_KUBO_API = 'http://127.0.0.1:5001'

function getKuboApiUrl(): string {
  // Prefer runtime configuration over env:
  // 1) window.__SJ_CONFIG__.ipfs.kuboApiBaseUrl
  // 2) <html data-sj-config-json="..."> with { ipfs: { kuboApiBaseUrl } }
  // 3) <html data-sj-ipfs-kubo="...">
  let raw: string | undefined

  const globalObj: any =
    typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {})

  const fromGlobal = globalObj?.__SJ_CONFIG__?.ipfs?.kuboApiBaseUrl
  if (typeof fromGlobal === 'string') {
    raw = fromGlobal
  }

  if (raw == null && typeof document !== 'undefined') {
    const html = document.documentElement
    const jsonAttr = html.getAttribute('data-sj-config-json')
    if (jsonAttr) {
      try {
        const parsed = JSON.parse(jsonAttr)
        const fromJson = parsed?.ipfs?.kuboApiBaseUrl
        if (typeof fromJson === 'string') raw = fromJson
      } catch {
        // ignore invalid JSON
      }
    }

    if (raw == null) {
      const attr = html.getAttribute('data-sj-ipfs-kubo')
      if (attr != null) raw = attr
    }
  }

  if (raw == null) {
    raw = (process.env.NEXT_PUBLIC_IPFS_KUBO_API ?? DEFAULT_KUBO_API)
  }

  return String(raw).trim().replace(/\/+$/, '')
}

async function addBytesViaKubo(
  bytes: Uint8Array,
  config?: Partial<IpfsClientConfig>
): Promise<AddBytesResult> {
  const baseUrl = getKuboApiUrl()
  const url = `${baseUrl}/api/v0/add?pin=false&cid-version=1`

  const form = new FormData()
  const payload = new Uint8Array(bytes)
  const blob = new Blob([payload], { type: 'application/octet-stream' })
  form.append('file', blob, 'payload.bin')

  const controller = new AbortController()
  const timeoutMs = config?.timeoutMs ?? IPFS_ADD_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Kubo add failed (${res.status}): ${text}`)
    }

    // Kubo returns NDJSON; parse last line
    const lines = text.trim().split('\n').filter(Boolean)
    const last = lines[lines.length - 1] ?? ''
    let parsed: any = null
    try {
      parsed = JSON.parse(last)
    } catch {
      throw new Error(`Kubo add response parse error: ${text}`)
    }

    const cid =
      parsed?.Hash ??
      parsed?.Cid?.['/'] ??
      parsed?.cid

    if (!cid) {
      throw new Error(`Kubo add response missing CID: ${text}`)
    }

    return { cid: String(cid), size: bytes.byteLength }
  } finally {
    clearTimeout(timer)
  }
}

function getBootstrapMultiaddrsFromRuntimeOrThrow(): string[] {
  // Prefer runtime configuration over environment variables.
  // Supported sources (in order):
  // 1) window.__SJ_CONFIG__.ipfs.bootstrapMultiaddrsCsv
  // 2) <html data-sj-config-json="..."> with { ipfs: { bootstrapMultiaddrsCsv } }
  // 3) <html data-sj-ipfs-bootstrap="...">
  let raw = ''

  const globalObj: any =
    typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {})

  const fromGlobal = globalObj?.__SJ_CONFIG__?.ipfs?.bootstrapMultiaddrsCsv
  if (typeof fromGlobal === 'string') {
    raw = fromGlobal
  }

  if (!raw && typeof document !== 'undefined') {
    const html = document.documentElement
    const jsonAttr = html.getAttribute('data-sj-config-json')
    if (jsonAttr) {
      try {
        const parsed = JSON.parse(jsonAttr)
        const fromJson = parsed?.ipfs?.bootstrapMultiaddrsCsv
        if (typeof fromJson === 'string') raw = fromJson
      } catch {
        // ignore invalid JSON
      }
    }

    if (!raw) {
      const attr = html.getAttribute('data-sj-ipfs-bootstrap')
      if (attr) raw = attr
    }
  }

  raw = (raw ?? '').trim()
  if (!raw) {
    throw new Error(
      'IPFS bootstrap not configured: set runtime config (window.__SJ_CONFIG__.ipfs.bootstrapMultiaddrsCsv or <html data-sj-ipfs-bootstrap="...">) ' +
        'e.g. /ip4/127.0.0.1/tcp/15002/ws/p2p/<PEER_ID>'
    )
  }
  const list = parseCsv(raw)
  if (list.length === 0) {
    throw new Error(
      'IPFS bootstrap not configured: runtime config is empty after parsing'
    )
  }
  return list
}

function normalizeBootstrapMultiaddrs(input: IpfsClientConfig['bootstrapMultiaddrs']): string[] {
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean)
  if (typeof input === 'string') return parseCsv(input)
  return []
}

function toMultiaddrsOrThrow(addrs: string[]): Multiaddr[] {
  if (!addrs || addrs.length === 0) {
    throw new Error('IPFS bootstrap multiaddrs missing')
  }
  try {
    return addrs.map((a) => multiaddr(a))
  } catch (e: any) {
    throw new Error(`Invalid bootstrap multiaddr: ${e?.message ?? String(e)}`)
  }
}

const IPFS_ADD_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

/* -------------------------
 * Helia singleton (browser)
 * ------------------------- */

type HeliaContext = {
  helia: Helia
  fs: UnixFS
  libp2p: Libp2p
}

let _ctxPromise: Promise<HeliaContext> | null = null

async function createHeliaContext(config?: Partial<IpfsClientConfig>): Promise<HeliaContext> {
  // Build bootstrap list from explicit config first, else runtime config (strict throw).
  const bootstrapStrings =
    config?.bootstrapMultiaddrs != null
      ? normalizeBootstrapMultiaddrs(config.bootstrapMultiaddrs)
      : getBootstrapMultiaddrsFromRuntimeOrThrow()

  const bootstrapAddrs = toMultiaddrsOrThrow(bootstrapStrings)

  // Minimal libp2p stack for browser:
  // - transports: websockets
  // - encryption: noise
  // - stream muxer: yamux
  // - peer discovery: bootstrap list (local node)
  const libp2p = (await createLibp2p({
    transports: [webSockets()],
    connectionEncrypters: [noise() as any],
    streamMuxers: [yamux() as any],
    peerDiscovery: [
      bootstrap({
        list: bootstrapAddrs.map((m) => m.toString()),
      }),
    ],
  })) as any

  const helia = await createHelia({ libp2p: libp2p as any })
  const fs = unixfs(helia)

  return { helia, fs, libp2p }
}

/**
 * Get (or lazily create) the Helia context.
 *
 * This keeps a singleton for the current page session.
 * No persistence is performed.
 */
export async function getIpfsContext(config?: Partial<IpfsClientConfig>): Promise<HeliaContext> {
  if (_ctxPromise) return _ctxPromise
  _ctxPromise = createHeliaContext(config)
  return _ctxPromise
}

/* -------------------------
 * Public API
 * ------------------------- */

/**
 * addBytes
 *
 * Adds raw bytes to IPFS using UnixFS.
 * Returns the CID string and the size.
 *
 * IMPORTANT:
 * - The bytes MUST already be encrypted (no plaintext).
 * - This function does not perform gating.
 */
export async function addBytes(bytes: Uint8Array, config?: Partial<IpfsClientConfig>): Promise<AddBytesResult> {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('addBytes: bytes must be a Uint8Array')
  }

  const max = config?.maxBytes
  if (typeof max === 'number' && max > 0 && bytes.byteLength > max) {
    throw new Error(`addBytes: object too large (${bytes.byteLength} bytes > ${max} bytes)`)
  }

  // MVP: prefer Kubo HTTP API when configured (default localhost)
  const kuboApi = getKuboApiUrl()
  if (kuboApi.length > 0) {
    debugLog('[IPFS] addBytes backend', { backend: 'kubo' })
    const res = await addBytesViaKubo(bytes, config)
    debugLog('[IPFS] addBytes ok', { cid: res.cid })
    return res
  }

  // Fallback: Helia in-browser
  debugLog('[IPFS] addBytes backend', { backend: 'helia' })
  const { fs } = await getIpfsContext(config)
  const cid: CID = await withTimeout(fs.addBytes(bytes), IPFS_ADD_TIMEOUT_MS, 'IPFS addBytes')
  debugLog('[IPFS] addBytes ok', { cid: cid.toString() })

  return { cid: cid.toString(), size: bytes.byteLength }
}

/**
 * addEncryptedPackage
 *
 * Adds a serialized encrypted IPFS object to IPFS.
 * Per spec, the CID MUST represent the entire encrypted object.
 *
 * This function accepts the object (already containing integrity.sha256B64),
 * serializes it, and uploads the bytes.
 */
export async function addEncryptedPackage(
  pkg: EncryptedIpfsObjectV1,
  config?: Partial<IpfsClientConfig>
): Promise<AddEncryptedPackageResult> {
  if (!pkg || pkg.version !== 1) {
    throw new Error('addEncryptedPackage: invalid package (expected version: 1)')
  }

  // Serialize deterministically enough for CID purposes:
  // JSON.stringify preserves object insertion order for own enumerable keys.
  // The spec does not mandate canonical JSON here; it mandates that CID covers the bytes uploaded.
  // If deterministic serialization is required later, we can move to JCS canonicalization (ProgDec).
  const json = JSON.stringify(pkg)
  const bytes = new TextEncoder().encode(json)

  const res = await addBytes(bytes, config)
  return { cid: res.cid }
}

/**
 * resetIpfsContextForTests
 *
 * Test-only helper: clears the in-memory singleton so tests can create a fresh Helia context.
 * (No production callers should use this.)
 */
export function resetIpfsContextForTests(): void {
  _ctxPromise = null
}
