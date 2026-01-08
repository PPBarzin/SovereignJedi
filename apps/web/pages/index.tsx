'use client'

import React, { useState } from 'react'
import cryptoAPI from '@sj/crypto'
import storageAPI from '@sj/storage'

/**
 * apps/web — index page
 *
 * Replaced inline ad-hoc crypto with real imports from `@sj/crypto` and `@sj/storage`.
 * Adds a minimal IPFS client stub that talks to a local go-ipfs HTTP API (default: http://127.0.0.1:5001/api/v0).
 *
 * Flow (minimal demo for Scope 1):
 *  - Select file -> read bytes
 *  - Generate per-file symmetric key (raw 32 bytes) using `cryptoAPI.cryptoGetRandomBytes`
 *  - Encrypt file content with `cryptoAPI.encryptAesGcmWithRawKey`
 *  - Upload encrypted file (iv + ciphertext) to IPFS via HTTP API `/add` -> receive CID (if IPFS is running)
 *  - Create a small manifest { fileName, cid } and encrypt it with a manifestKey (random 32 bytes)
 *  - Persist encrypted manifest in IndexedDB using `storageAPI.putManifest`
 *  - Provide a simple retrieval button to read, decrypt and display stored manifest
 *
 * NOTE: This is a demo stub for Scope 1. No wallet or signature flows are implemented (Scope 2).
 */

const IPFS_API_BASE = process.env.NEXT_PUBLIC_IPFS_API_URL ?? 'http://127.0.0.1:5001/api/v0'

function toHex(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function concatUint8(arrs: Uint8Array[]) {
  const total = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrs) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

async function ipfsAdd(blob: Blob): Promise<string> {
  // Minimal IPFS /add via HTTP API. Returns CID string (Hash).
  // If IPFS is not reachable, we throw and the caller can fall back to a simulated CID.
  const url = `${IPFS_API_BASE}/add`
  const form = new FormData()
  form.append('file', blob, 'encrypted.bin')
  const res = await fetch(url, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    throw new Error(`IPFS add failed: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  // go-ipfs API returns JSON lines; parse the last non-empty line
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) throw new Error('IPFS returned empty response')
  const last = lines[lines.length - 1]
  // Each line should be a JSON object like {"Name":"...","Hash":"Qm...","Size":"..."}
  try {
    const parsed = JSON.parse(last)
    return parsed.Hash ?? parsed.Key ?? parsed.cid ?? ''
  } catch (err) {
    // If parsing fails, return the raw line as fallback
    return last
  }
}

export default function Home(): JSX.Element {
  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Idle')
  const [cid, setCid] = useState<string | null>(null)
  const [storedManifest, setStoredManifest] = useState<any | null>(null)

  // ephemeral manifestKey used only for demo to encrypt/decrypt the manifest
  // In a real system this would be derived from a wallet signature (Scope 2).
  const [manifestKey, setManifestKey] = useState<Uint8Array | null>(null)

  async function handleFile(file: File | null) {
    setCid(null)
    setStoredManifest(null)

    if (!file) {
      setFileName(null)
      setStatus('Idle')
      return
    }

    setFileName(file.name)
    setStatus('Reading file')

    const arrayBuffer = await file.arrayBuffer()
    const fileBytes = new Uint8Array(arrayBuffer)

    setStatus('Generating per-file symmetric key')
    // per-file raw AES key bytes (32 bytes)
    const perFileKey = cryptoAPI.cryptoGetRandomBytes(32)

    setStatus('Encrypting file (AES-GCM)')
    const { iv, ciphertext } = await cryptoAPI.encryptAesGcmWithRawKey(perFileKey, fileBytes)

    // Combine iv + ciphertext for upload
    const combined = concatUint8([iv, ciphertext])
    const blob = new Blob([combined], { type: 'application/octet-stream' })

    setStatus('Uploading encrypted file to IPFS (stub)')
    let fileCid: string | null = null
    try {
      fileCid = await ipfsAdd(blob)
      setCid(fileCid)
      setStatus(`Uploaded to IPFS: ${fileCid}`)
    } catch (err) {
      // IPFS not available — simulate a local CID to still exercise storage
      const simulated = `SIMULATED-${toHex(cryptoAPI.cryptoGetRandomBytes(8))}`
      fileCid = simulated
      setCid(simulated)
      setStatus(`IPFS unavailable — using simulated CID: ${simulated}`)
    }

    setStatus('Preparing encrypted manifest and storing in IndexedDB')

    // Create manifest JSON and encrypt it with a manifestKey (ephemeral here)
    const manifest = {
      fileName: file.name,
      cid: fileCid,
      createdAt: new Date().toISOString(),
    }
    const manifestJson = JSON.stringify(manifest)
    const manifestBytes = new TextEncoder().encode(manifestJson)

    // create or reuse manifestKey for demo
    const mk = manifestKey ?? cryptoAPI.cryptoGetRandomBytes(32)
    setManifestKey(mk)

    const { iv: mIv, ciphertext: mCt } = await cryptoAPI.encryptAesGcmWithRawKey(mk, manifestBytes)
    const manifestBlob = concatUint8([mIv, mCt])
    const manifestB64 = storageAPI.toBase64(manifestBlob)

    // persist using storage API
    try {
      storageAPI.initStorage()
      await storageAPI.putManifest('local-dev-wallet', manifestB64, fileCid)
      setStatus('Manifest stored in local IndexedDB (encrypted)')
    } catch (err: any) {
      console.error('storage putManifest error', err)
      setStatus(`Failed to store manifest locally: ${err?.message ?? String(err)}`)
    }
  }

  async function retrieveAndDecryptManifest() {
    setStatus('Retrieving manifest from local storage')
    try {
      storageAPI.initStorage()
      const payload = await storageAPI.getManifest('local-dev-wallet')
      if (!payload) {
        setStoredManifest(null)
        setStatus('No manifest found for wallet')
        return
      }
      const encryptedB64 = payload.encryptedManifestB64
      const bytes = storageAPI.fromBase64(encryptedB64)
      // assume iv is first 12 bytes (AES-GCM)
      const iv = bytes.slice(0, 12)
      const ct = bytes.slice(12)
      if (!manifestKey) {
        setStatus('No manifestKey available in session to decrypt (demo limitation).')
        return
      }
      const plain = await cryptoAPI.decryptAesGcmWithRawKey(manifestKey, iv, ct)
      const json = new TextDecoder().decode(plain)
      setStoredManifest(JSON.parse(json))
      setStatus('Manifest retrieved and decrypted (demo)')
    } catch (err: any) {
      console.error('retrieve error', err)
      setStatus(`Error retrieving/decrypting manifest: ${err?.message ?? String(err)}`)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    void handleFile(f ?? null)
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 32 }}>
      <h1>Sovereign Jedi — Web (Scope 1 Demo)</h1>

      <section style={{ marginTop: 16, padding: 16, border: '1px solid #e6edf3', borderRadius: 8 }}>
        <h2>File encrypt → IPFS → local encrypted manifest (IndexedDB)</h2>
        <p style={{ color: '#444' }}>
          This demo uses the shared packages <code>@sj/crypto</code> and <code>@sj/storage</code>.
          It encrypts the selected file locally, attempts to upload the encrypted blob to a local IPFS node,
          then stores an encrypted manifest in IndexedDB via Dexie.
        </p>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Select a file:
          </label>
          <input type="file" onChange={handleInputChange} />
        </div>

        <div style={{ marginTop: 12 }}>
          <strong>Status:</strong> <span>{status}</span>
        </div>

        {fileName && (
          <div style={{ marginTop: 12 }}>
            <div><strong>Last file:</strong> {fileName}</div>
            {cid && <div><strong>CID:</strong> <code style={{ fontFamily: 'monospace' }}>{cid}</code></div>}
            {manifestKey && <div><strong>Manifest key (hex, session only):</strong> <code style={{ fontFamily: 'monospace' }}>{toHex(manifestKey)}</code></div>}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button onClick={() => void retrieveAndDecryptManifest()} style={{ padding: '8px 12px', marginRight: 8 }}>
            Retrieve & decrypt stored manifest
          </button>
          <button onClick={() => { setStoredManifest(null); setStatus('Idle') }} style={{ padding: '8px 12px' }}>
            Reset view
          </button>
        </div>

        {storedManifest && (
          <div style={{ marginTop: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
            <strong>Stored manifest (decrypted):</strong>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{JSON.stringify(storedManifest, null, 2)}</pre>
          </div>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>Notes & next steps</h3>
        <ul>
          <li>This page now imports and uses <code>@sj/crypto</code> and <code>@sj/storage</code> directly.</li>
          <li>IPFS calls go to <code>{IPFS_API_BASE}</code> by default — run the local Docker Compose in <code>infra/ipfs</code> to enable real uploads.</li>
          <li>No wallet/signature flows are included here (Scope 2). The manifest key is a session-only random key to exercise encryption/decryption and storage integration.</li>
          <li>When this flow compiles and runs locally (and you see a stored manifest decrypted), we can commit all changes and open the PR for Scope 1.</li>
        </ul>
      </section>
    </div>
  )
}
