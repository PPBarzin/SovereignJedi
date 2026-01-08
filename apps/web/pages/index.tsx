'use client'

import React, { useState } from 'react'

function toHex(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generateFileKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

async function encryptWithKey(key: CryptoKey, data: ArrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  )
  return { iv: new Uint8Array(iv), encrypted: new Uint8Array(encrypted) }
}

async function digestSHA256(data: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

export default function Home(): JSX.Element {
  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Idle')
  const [encryptedUrl, setEncryptedUrl] = useState<string | null>(null)
  const [cidHex, setCidHex] = useState<string | null>(null)
  const [encryptedSize, setEncryptedSize] = useState<number | null>(null)

  async function handleFile(file: File | null) {
    setEncryptedUrl(null)
    setCidHex(null)
    setEncryptedSize(null)

    if (!file) {
      setFileName(null)
      setStatus('Idle')
      return
    }

    setFileName(file.name)
    setStatus('Reading file')

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()

    setStatus('Generating local per-file key (client only)')
    // generate per-file symmetric key (never transmitted)
    const key = await generateFileKey()

    setStatus('Encrypting locally (AES-GCM)')
    const { iv, encrypted } = await encryptWithKey(key, arrayBuffer)

    setEncryptedSize(encrypted.byteLength)

    setStatus('Computing local integrity hash (SHA-256)')
    // compute hash of encrypted content to simulate CID derivation (local only)
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength)
    combined.set(iv, 0)
    combined.set(encrypted, iv.byteLength)

    const hash = await digestSHA256(combined.buffer)
    const hex = toHex(hash.buffer)
    setCidHex(hex)

    setStatus('Preparing encrypted file for download (local only)')
    // create a downloadable blob for the encrypted content (still local)
    const blob = new Blob([combined], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    setEncryptedUrl(url)

    setStatus('Done — all operations performed locally. No keys or plaintext left the device.')
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    void handleFile(f ?? null)
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 32 }}>
      <h1>Sovereign Jedi — Web (Skeleton)</h1>

      <section style={{ marginTop: 24, padding: 16, border: '1px solid #e6edf3', borderRadius: 8 }}>
        <h2>Quick demo — Local encryption pipeline</h2>
        <p style={{ color: '#444' }}>
          This page demonstrates the core security rule: encryption and key generation happen locally.
          Selected file is encrypted in the browser and an integrity hash is computed locally to simulate
          a CID (no network calls are made).
        </p>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Select a file (the file is read and encrypted locally):
          </label>
          <input type="file" onChange={handleInputChange} />
        </div>

        <div style={{ marginTop: 16 }}>
          <strong>Status:</strong> <span>{status}</span>
        </div>

        {fileName && (
          <div style={{ marginTop: 12 }}>
            <div><strong>File:</strong> {fileName}</div>
            {encryptedSize !== null && <div><strong>Encrypted size:</strong> {encryptedSize} bytes</div>}
            {cidHex && (
              <div style={{ marginTop: 8 }}>
                <strong>Local integrity hash (simulated CID):</strong>
                <div style={{
                  marginTop: 6,
                  padding: 8,
                  background: '#111827',
                  color: '#e6f0ff',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  overflowX: 'auto'
                }}>{cidHex}</div>
              </div>
            )}

            {encryptedUrl && (
              <div style={{ marginTop: 12 }}>
                <a href={encryptedUrl} download={`${fileName}.encrypted`} style={{
                  display: 'inline-block',
                  padding: '8px 12px',
                  background: '#0ea5e9',
                  color: '#fff',
                  borderRadius: 6,
                  textDecoration: 'none'
                }}>
                  Download encrypted file (local)
                </a>
              </div>
            )}
          </div>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>Notes & next steps</h3>
        <ul>
          <li>All cryptographic operations above use the browser <code>Web Crypto API</code>.</li>
          <li>The per-file symmetric key is generated on the device and never exported or transmitted.</li>
          <li>To complete the MVP: implement manifest encryption, IPFS upload, and wallet-derived key wrapping.</li>
          <li>Use the <code>@sj/crypto</code> and <code>@sj/storage</code> packages for shared logic once available.</li>
        </ul>
      </section>

      <footer style={{ marginTop: 40, color: '#666' }}>
        <small>Local demo — no network activity. This is safe for quick testing of the encryption flow.</small>
      </footer>
    </div>
  )
}
