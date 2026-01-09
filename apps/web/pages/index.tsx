'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'

type UiState = 'idle' | 'loading' | 'success' | 'error'

type MockFileRow = {
  id: string
  name: string
  size: string
  status: 'Processing' | 'Ready' | 'Error'
  cid?: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function mockCid(): string {
  // simple readable mock CID
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const rand = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `bafy${rand(10)}${rand(10)}${rand(10)}`
}

function mockWalletAddress(): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const rand = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `${rand(4)}...${rand(4)}`
}

export default function Home(): JSX.Element {
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  const [uiState, setUiState] = useState<UiState>('idle')
  const [dragActive, setDragActive] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [files, setFiles] = useState<MockFileRow[]>([
    {
      id: 'init-1',
      name: 'product-vision.pdf',
      size: '342 KB',
      status: 'Ready',
      cid: mockCid(),
    },
    {
      id: 'init-2',
      name: 'screenshot.png',
      size: '1.2 MB',
      status: 'Ready',
      cid: mockCid(),
    },
  ])

  const inputRef = useRef<HTMLInputElement | null>(null)

  const headerStatus = useMemo(() => {
    if (!walletConnected) return 'Not connected (mock)'
    return `Connected: ${walletAddress}`
  }, [walletConnected, walletAddress])

  const onConnectToggle = useCallback(() => {
    if (walletConnected) {
      setWalletConnected(false)
      setWalletAddress(null)
    } else {
      setWalletConnected(true)
      setWalletAddress(mockWalletAddress())
    }
  }, [walletConnected])

  const handleSelectClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const processFile = useCallback((file: File) => {
    // Visual states
    setUiState('loading')
    setErrorMsg(null)

    // Add a temporary row with Processing state
    const tempId = `row-${Date.now()}`
    const newRow: MockFileRow = {
      id: tempId,
      name: file.name,
      size: formatBytes(file.size),
      status: 'Processing',
    }
    setFiles((prev) => [newRow, ...prev])

    // Simulate processing delay and outcome
    const simulateMs = 1200 + Math.floor(Math.random() * 800)
    const shouldError = Math.random() < 0.08 // ~8% error to show the state exists

    window.setTimeout(() => {
      if (shouldError) {
        setFiles((prev) =>
          prev.map((r) => (r.id === tempId ? { ...r, status: 'Error', cid: undefined } : r)),
        )
        setUiState('error')
        setErrorMsg('Something went wrong. Please try again.')
        return
      }
      setFiles((prev) =>
        prev.map((r) => (r.id === tempId ? { ...r, status: 'Ready', cid: mockCid() } : r)),
      )
      setUiState('success')
      setErrorMsg(null)
    }, simulateMs)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      const f = e.dataTransfer.files && e.dataTransfer.files[0]
      if (f) processFile(f)
    },
    [processFile],
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }, [])

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files && e.target.files[0]
      if (f) processFile(f)
      e.currentTarget.value = '' // reset to allow re-selecting same file
    },
    [processFile],
  )

  const StateBadge = ({ state }: { state: UiState }) => {
    const color =
      state === 'idle'
        ? '#64748b'
        : state === 'loading'
        ? '#0ea5e9'
        : state === 'success'
        ? '#10b981'
        : '#ef4444'
    const label =
      state === 'idle' ? 'Idle' : state === 'loading' ? 'Processing…' : state === 'success' ? 'Done' : 'Error'
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: '#f1f5f9',
          border: `1px solid ${color}`,
          color,
          padding: '6px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.2,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: color,
            display: 'inline-block',
          }}
        />
        {label}
      </span>
    )
  }

  const StatusPill = ({ status }: { status: MockFileRow['status'] }) => {
    const colors =
      status === 'Ready'
        ? { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }
        : status === 'Processing'
        ? { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }
        : { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' }
    return (
      <span
        style={{
          padding: '4px 8px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          background: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        {status}
      </span>
    )
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', background: '#0b1220', minHeight: '100vh' }}>
      {/* Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(14, 23, 42, 0.9)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: '0 auto',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              aria-hidden
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background:
                  'conic-gradient(from 180deg at 50% 50%, #22d3ee 0deg, #22c55e 120deg, #a78bfa 240deg, #22d3ee 360deg)',
                boxShadow: '0 0 20px rgba(34, 211, 238, 0.25)',
              }}
            />
            <strong style={{ fontSize: 16, letterSpacing: 0.4 }}>Sovereign Jedi</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                color: walletConnected ? '#10b981' : '#94a3b8',
                fontSize: 12,
                background: '#0f172a',
                border: '1px solid #1e293b',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              Wallet: {headerStatus}
            </span>
            <button
              onClick={onConnectToggle}
              style={{
                appearance: 'none',
                border: '1px solid #334155',
                background: '#111827',
                color: '#e5e7eb',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {walletConnected ? 'Disconnect (mock)' : 'Connect Wallet (mock)'}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '24px 20px' }}>
        {/* Drag & Drop card */}
        <section
          style={{
            background: 'linear-gradient(180deg, #0b1220 0%, #0b1220 60%, rgba(15,23,42,0.8) 100%)',
            border: '1px solid #1f2a44',
            borderRadius: 16,
            padding: 20,
            color: '#cbd5e1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>Add a file</h2>
              <p style={{ margin: '6px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
                Drag & drop your file below (or click to select).
              </p>
            </div>
            <StateBadge state={uiState} />
          </div>

          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={handleSelectClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleSelectClick()
            }}
            aria-label="Drop a file to encrypt or click to select"
            style={{
              userSelect: 'none',
              cursor: 'pointer',
              border: dragActive ? '2px dashed #22d3ee' : '2px dashed #334155',
              background: dragActive ? 'rgba(34,211,238,0.06)' : '#0f172a',
              borderRadius: 14,
              padding: '40px 16px',
              transition: 'all 120ms ease',
            }}
          >
            <div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
              <div
                aria-hidden
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: dragActive
                    ? 'linear-gradient(135deg, #22d3ee 0%, #a78bfa 100%)'
                    : 'linear-gradient(135deg, #1e293b 0%, #0b1220 100%)',
                  border: '1px solid #1e293b',
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: dragActive ? '0 0 30px rgba(34,211,238,0.25)' : 'none',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke={dragActive ? '#0b1220' : '#94a3b8'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20 21H4" stroke={dragActive ? '#0b1220' : '#94a3b8'} strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#e2e8f0', fontWeight: 700, letterSpacing: 0.2 }}>Drop a file to encrypt</div>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>[ or click to select ]</div>
              </div>

              {/* Progress bar for loading */}
              {uiState === 'loading' && (
                <div style={{ width: 320, maxWidth: '90%', height: 8, background: '#0b1220', borderRadius: 8, border: '1px solid #1e293b', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: '65%',
                      height: '100%',
                      background: 'linear-gradient(90deg, #22d3ee, #a78bfa)',
                      boxShadow: '0 0 12px rgba(167,139,250,0.4)',
                      animation: 'progressPulse 1.2s ease-in-out infinite',
                    }}
                  />
                </div>
              )}

              {/* Success capsule */}
              {uiState === 'success' && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: '1px solid #134e4a',
                    background: '#052e2b',
                    color: '#34d399',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: '#34d399', display: 'inline-block' }} />
                  File added
                </div>
              )}

              {/* Error capsule */}
              {uiState === 'error' && (
                <div
                  role="alert"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: '1px solid #7f1d1d',
                    background: '#2b0b0b',
                    color: '#fca5a5',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: '#ef4444', display: 'inline-block' }} />
                  {errorMsg ?? 'Something went wrong'}
                </div>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={inputRef}
              type="file"
              onChange={onInputChange}
              style={{ display: 'none' }}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
        </section>

        {/* My Files (mock) */}
        <section
          style={{
            marginTop: 20,
            background: '#0f172a',
            border: '1px solid #1f2a44',
            borderRadius: 16,
            padding: 16,
            color: '#cbd5e1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#e2e8f0' }}>My files (mock)</h3>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>{files.length} items</div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #1f2a44' }}>File name</th>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #1f2a44' }}>Size</th>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #1f2a44' }}>Status</th>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #1f2a44' }}>CID (mock)</th>
                </tr>
              </thead>
              <tbody>
                {files.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #0b1220' }}>
                    <td style={{ padding: '10px 8px', color: '#e5e7eb', fontWeight: 600 }}>{row.name}</td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8', fontSize: 13 }}>{row.size}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <StatusPill status={row.status} />
                    </td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace', fontSize: 12 }}>
                      {row.cid ? <code>{row.cid}</code> : <span style={{ color: '#64748b' }}>–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Footnote */}
        <section style={{ marginTop: 24, color: '#64748b', fontSize: 12, textAlign: 'center' }}>
          <div>This is a product demo UI (mocked). No external services are required.</div>
        </section>
      </main>

      {/* Keyframes (inline) */}
      <style>{`
        @keyframes progressPulse {
          0% { transform: translateX(-30%); }
          50% { transform: translateX(10%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
