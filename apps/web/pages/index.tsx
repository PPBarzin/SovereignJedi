'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Task 2.5 — UI Mock (Product-like)
 * - Header: Logo, wallet mock state, theme toggle with persistence (localStorage)
 * - Left panel: Filters (All, Shared with me, Private, Project X, Invoices)
 * - Main panel: File list (no technical details like CID), global DnD overlay, states (idle/drag-over/loading/success/error)
 * - File properties overlay: opens on row click (only place where CID and technical-ish details appear)
 * - 100% mocked — no real network/crypto/storage
 */

/* ---------------------------------- */
/* Theme                                                                   */
/* ---------------------------------- */

type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'sj_theme'

const lightTokens = {
  pageBg: '#f8fafc',
  text: '#0f172a',
  subtext: '#475569',
  border: '#e2e8f0',
  panelBg: '#ffffff',
  headerBg: '#0b1220',
  headerFg: '#e2e8f0',
  headerBorder: '#0f172a',
  mutedBg: '#f1f5f9',
  mutedFg: '#64748b',
  accent: '#0ea5e9',
  accent2: '#a78bfa',
  ok: '#10b981',
  warn: '#eab308',
  danger: '#ef4444',
  focusRing: 'rgba(14,165,233,0.25)',
}

const darkTokens = {
  pageBg: '#0b1220',
  text: '#e2e8f0',
  subtext: '#94a3b8',
  border: '#334155',
  panelBg: '#0f172a',
  headerBg: 'rgba(14, 23, 42, 0.9)',
  headerFg: '#e2e8f0',
  headerBorder: '#1e293b',
  mutedBg: '#111827',
  mutedFg: '#94a3b8',
  accent: '#22d3ee',
  accent2: '#a78bfa',
  ok: '#34d399',
  warn: '#fbbf24',
  danger: '#f87171',
  focusRing: 'rgba(167,139,250,0.25)',
}

/* ---------------------------------- */
/* Types & Mock helpers                                                   */
/* ---------------------------------- */

type FileStatus = 'Ready' | 'Shared' | 'Pending'
type FileItem = {
  id: string
  name: string
  sizeBytes: number
  sizeText: string
  status: FileStatus
  dateISO: string
  sharedWith: string[]
  tags: string[]
  cid: string // only surfaced in the properties panel
}

type UiFlow = 'idle' | 'drag-over' | 'loading' | 'success' | 'error'

const formatBytes = (n: number) => {
  if (!n) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return `${(n / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))
const choice = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

const mockCid = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const rand = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `bafy${rand(10)}${rand(10)}${rand(4)}`
}

const mockWalletAddr = () => {
  const al = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const rand = (n: number) => Array.from({ length: n }, () => al[Math.floor(Math.random() * al.length)]).join('')
  return `${rand(4)}...${rand(4)}`
}

/* ---------------------------------- */
/* Component                                                               */
/* ---------------------------------- */

export default function Home(): JSX.Element {
  // Theme
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => {
    const stored = (typeof window !== 'undefined' && window.localStorage.getItem(THEME_STORAGE_KEY)) as Theme | null
    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  }, [theme])

  const t = useMemo(() => (theme === 'light' ? lightTokens : darkTokens), [theme])

  // Hydration guard (avoid server/client date mismatch)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
  }, [])

  // Wallet mock
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const toggleWallet = useCallback(() => {
    setWalletConnected((v) => {
      if (v) {
        setWalletAddress(null)
        return false
      } else {
        setWalletAddress(mockWalletAddr())
        return true
      }
    })
  }, [])

  // Filters (left panel)
  type FilterKey = 'all' | 'shared' | 'private' | 'projectX' | 'invoices'
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')

  // Mocked files dataset
  const [files, setFiles] = useState<FileItem[]>(() => {
    const seed: FileItem[] = [
      {
        id: 'f-1',
        name: 'product-vision.pdf',
        sizeBytes: 350_000,
        sizeText: formatBytes(350_000),
        status: 'Ready',
        dateISO: new Date(Date.now() - 86400000 * 4).toISOString(),
        sharedWith: [],
        tags: ['projectX'],
        cid: mockCid(),
      },
      {
        id: 'f-2',
        name: 'invoice-2025-0007.pdf',
        sizeBytes: 120_000,
        sizeText: formatBytes(120_000),
        status: 'Shared',
        dateISO: new Date(Date.now() - 86400000 * 2).toISOString(),
        sharedWith: ['alice.sol'],
        tags: ['invoices'],
        cid: mockCid(),
      },
      {
        id: 'f-3',
        name: 'screenshot.png',
        sizeBytes: 2_340_000,
        sizeText: formatBytes(2_340_000),
        status: 'Ready',
        dateISO: new Date(Date.now() - 3600_000 * 15).toISOString(),
        sharedWith: [],
        tags: [],
        cid: mockCid(),
      },
      {
        id: 'f-4',
        name: 'project-x-notes.md',
        sizeBytes: 42_000,
        sizeText: formatBytes(42_000),
        status: 'Pending',
        dateISO: new Date(Date.now() - 3600_000 * 2).toISOString(),
        sharedWith: [],
        tags: ['projectX'],
        cid: mockCid(),
      },
    ]
    return seed
  })

  // Drag & Drop (main overlay)
  const [uiFlow, setUiFlow] = useState<UiFlow>('idle')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragCounter = useRef(0)

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setUiFlow((prev) => (prev === 'loading' ? prev : 'drag-over'))
  }, [])
  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setUiFlow((prev) => (prev === 'loading' ? prev : 'idle'))
  }, [])
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFile(f)
    else setUiFlow('idle')
  }, [])

  const openPicker = useCallback(() => fileInputRef.current?.click(), [])
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.currentTarget.value = ''
  }, [])

  // Simulate processing of a file drop / selection
  const handleFile = useCallback((file: File) => {
    // enter loading
    setUiFlow('loading')
    const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const base: FileItem = {
      id,
      name: file.name,
      sizeBytes: file.size,
      sizeText: formatBytes(file.size),
      status: 'Pending',
      dateISO: new Date().toISOString(),
      sharedWith: [],
      tags: [],
      cid: mockCid(),
    }
    setFiles((prev) => [base, ...prev])

    const ms = randInt(900, 1800)
    const willShare = Math.random() < 0.25
    window.setTimeout(() => {
      setFiles((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                status: willShare ? 'Shared' : 'Ready',
                sharedWith: willShare ? ['demo-user.sol'] : [],
              }
            : it,
        ),
      )
      setUiFlow('success')
      // brief success state then back to idle
      window.setTimeout(() => setUiFlow('idle'), 1000)
    }, ms)
  }, [])

  // Filtering logic
  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'all':
        return files
      case 'shared':
        return files.filter((f) => f.sharedWith.length > 0 || f.status === 'Shared')
      case 'private':
        return files.filter((f) => f.sharedWith.length === 0 && f.status !== 'Shared')
      case 'projectX':
        return files.filter((f) => f.tags.includes('projectX'))
      case 'invoices':
        return files.filter((f) => f.tags.includes('invoices') || f.name.toLowerCase().includes('invoice'))
      default:
        return files
    }
  }, [files, activeFilter])

  // File properties overlay (only place where CID appears)
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const closeOverlay = useCallback(() => setActiveFile(null), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeOverlay])

  /* ---------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------- */

  return (
    <div style={{ ...styles.page, background: t.pageBg, color: t.text }}>
      {/* Header */}
      <header
        style={{
          ...styles.header,
          background: t.headerBg,
          color: t.headerFg,
          borderBottom: `1px solid ${t.headerBorder}`,
        }}
      >
        <div style={styles.headerLeft}>
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: `conic-gradient(from 180deg at 50% 50%, ${t.accent} 0deg, ${t.ok} 120deg, ${t.accent2} 240deg, ${t.accent} 360deg)`,
              boxShadow: `0 0 20px ${theme === 'light' ? 'rgba(14,165,233,0.25)' : 'rgba(34,211,238,0.25)'}`,
            }}
          />
          <strong style={{ letterSpacing: 0.3 }}>Sovereign Jedi</strong>
        </div>

        <div style={styles.headerRight}>
          <button
            onClick={() => setTheme((v) => (v === 'light' ? 'dark' : 'light'))}
            aria-label="Toggle theme"
            style={{
              ...styles.btn,
              borderColor: t.border,
              background: t.mutedBg,
              color: t.text,
            }}
          >
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>

          <span
            style={{
              ...styles.badge,
              color: walletConnected ? t.ok : t.subtext,
              borderColor: walletConnected ? t.ok : t.border,
              background: theme === 'light' ? '#fff' : t.mutedBg,
            }}
          >
            Wallet: {walletConnected ? `Connected (${walletAddress})` : 'Not connected'}
          </span>
          <button
            onClick={toggleWallet}
            style={{
              ...styles.btn,
              borderColor: t.border,
              background: t.mutedBg,
              color: t.text,
            }}
          >
            {walletConnected ? 'Disconnect (mock)' : 'Connect Wallet (mock)'}
          </button>
        </div>
      </header>

      {/* Body layout */}
      <div style={styles.body}>
        {/* Left panel — Filters */}
        <aside
          style={{
            ...styles.left,
            background: t.panelBg,
            borderRight: `1px solid ${t.border}`,
          }}
        >
          <div style={{ ...styles.leftHeader, color: t.subtext }}>My Files</div>
          <nav style={styles.leftNav}>
            {[
              { key: 'all', label: 'All files' },
              { key: 'shared', label: 'Shared with me' },
              { key: 'private', label: 'Private' },
              { key: 'projectX', label: 'Project X' },
              { key: 'invoices', label: 'Invoices' },
            ].map((f) => {
              const k = f.key as FilterKey
              const active = activeFilter === k
              return (
                <button
                  key={k}
                  onClick={() => setActiveFilter(k)}
                  style={{
                    ...styles.leftItem,
                    color: active ? t.accent : t.text,
                    background: active ? (theme === 'light' ? '#f0f9ff' : '#0b1220') : 'transparent',
                    borderColor: active ? t.accent : 'transparent',
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main panel — DnD + File list */}
        <main style={{ ...styles.main }}>
          {/* Drop zone card (centered) */}
          <div
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{ position: 'relative' }}
          >
            <div
              onClick={openPicker}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? openPicker() : null)}
              style={{
                ...styles.dropEmpty,
                border: `2px dashed ${t.border}`,
                background: theme === 'light' ? '#fff' : t.panelBg,
                color: t.subtext,
              }}
            >
              <div aria-hidden style={{ width: 44, height: 44, borderRadius: 10, border: `1px solid ${t.border}`, display: 'grid', placeItems: 'center', background: theme === 'light' ? '#f8fafc' : '#0b1220', marginBottom: 8 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke={t.subtext} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20 21H4" stroke={t.subtext} strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ fontWeight: 800, color: t.text, marginBottom: 6 }}>Drop files here to upload</div>
              <button onClick={(e)=>{e.stopPropagation(); openPicker();}} style={{ ...styles.btn, borderColor: t.border, background: theme === 'light' ? '#e2e8f0' : t.mutedBg, color: t.text }}>Select Files</button>
              {uiFlow === 'loading' && (
                <div style={{ width: 320, maxWidth: '90%', height: 8, background: theme === 'light' ? lightTokens.mutedBg : darkTokens.mutedBg, borderRadius: 8, border: `1px solid ${t.border}`, overflow: 'hidden', marginTop: 12 }}>
                  <div style={{ width: '65%', height: '100%', background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})`, animation: 'progressPulse 1.2s ease-in-out infinite' }} />
                </div>
              )}
              {uiFlow === 'success' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, border: `1px solid ${theme === 'light' ? '#a7f3d0' : '#134e4a'}`, background: theme === 'light' ? '#ecfdf5' : '#052e2b', color: t.ok, fontWeight: 700, fontSize: 12, marginTop: 8 }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: t.ok, display: 'inline-block' }} />
                  File added
                </div>
              )}
              {uiFlow === 'error' && (
                <div role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, border: `1px solid ${theme === 'light' ? '#fecaca' : '#7f1d1d'}`, background: theme === 'light' ? '#fef2f2' : '#2b0b0b', color: t.danger, fontWeight: 700, fontSize: 12, marginTop: 8 }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: t.danger, display: 'inline-block' }} />
                  Something went wrong
                </div>
              )}
            </div>
          </div>

          {/* Hidden input */}
          <input ref={fileInputRef} type="file" onChange={onInputChange} style={{ display: 'none' }} />

          {/* File list (no CID here) */}

          <div
            style={{
              marginTop: 16,
              background: t.panelBg,
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 140px 160px 100px',
                gap: 0,
                borderBottom: `1px solid ${t.border}`,
                color: t.subtext,
                fontSize: 12,
                padding: '10px 12px',
              }}
            >
              <div>Name</div>
              <div>Size</div>
              <div>Status</div>
              <div>Date</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>

            {filtered.map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFile(f)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 120px 140px 160px 100px',
                  gap: 0,
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  borderBottom: `1px solid ${t.border}`,
                  color: t.text,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                <div style={{ color: t.subtext }}>{f.sizeText}</div>
                <div>
                  <span
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      border: `1px solid ${
                        f.status === 'Ready' ? (theme === 'light' ? '#a7f3d0' : '#134e4a') : f.status === 'Shared' ? '#bfdbfe' : '#fde68a'
                      }`,
                      background:
                        f.status === 'Ready'
                          ? theme === 'light'
                            ? '#ecfdf5'
                            : '#052e2b'
                          : f.status === 'Shared'
                          ? theme === 'light'
                            ? '#eff6ff'
                            : '#0b1220'
                          : theme === 'light'
                          ? '#fffbeb'
                          : '#3b2f0b',
                      color: f.status === 'Ready' ? (theme === 'light' ? '#047857' : '#34d399') : f.status === 'Shared' ? '#1d4ed8' : '#b45309',
                    }}
                  >
                    {f.status}
                  </span>
                </div>
                <div style={{ color: t.subtext }} suppressHydrationWarning>{hydrated ? new Date(f.dateISO).toLocaleString() : ''}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button aria-label="More actions" onClick={(e)=>{e.stopPropagation();}} style={{ background: 'transparent', border: '1px solid ' + t.border, borderRadius: 8, padding: '4px 8px', color: t.subtext }}>
                    ⋯
                  </button>
                </div>
              </button>
            ))}

            {filtered.length === 0 && (
              <div style={{ padding: 16, color: t.subtext }}>No files in this view yet — drop a file above.</div>
            )}
            <div style={{ padding: '10px 12px', color: t.subtext, fontSize: 12 }}>
              1–{filtered.length} of {filtered.length}
            </div>
          </div>
        </main>
      </div>

      {/* Properties overlay (with CID, shares, permissions mock) */}
      {activeFile && (
        <>
          <div
            onClick={closeOverlay}
            style={{
              position: 'fixed',
              inset: 0,
              background: theme === 'light' ? 'rgba(15,23,42,0.35)' : 'rgba(2,6,23,0.6)',
              backdropFilter: 'blur(2px)',
              zIndex: 30,
            }}
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label="File properties"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 420,
              maxWidth: '90vw',
              background: t.panelBg,
              color: t.text,
              borderLeft: `1px solid ${t.border}`,
              boxShadow: theme === 'light' ? '0 10px 30px rgba(15,23,42,0.15)' : '0 10px 30px rgba(2,6,23,0.35)',
              zIndex: 40,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: `1px solid ${t.border}` }}>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 2 }}>File properties</div>
                <div style={{ color: t.subtext, fontSize: 12 }}>Details are visible here only (not in main list)</div>
              </div>
              <button
                onClick={closeOverlay}
                aria-label="Close"
                style={{
                  ...styles.btn,
                  borderColor: t.border,
                  background: t.mutedBg,
                  color: t.text,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ padding: 16, display: 'grid', gap: 12, alignContent: 'start', overflow: 'auto' }}>
              <Field label="Name">
                <strong>{activeFile.name}</strong>
              </Field>
              <Field label="Size">{activeFile.sizeText}</Field>
              <Field label="Status">{activeFile.status}</Field>
              <Field label="Date"><span suppressHydrationWarning>{hydrated ? new Date(activeFile.dateISO).toLocaleString() : ''}</span></Field>

              <div style={{ height: 1, background: t.border, margin: '8px 0' }} />

              <Field label="CID (mock)">
                <code
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    background: theme === 'light' ? '#f8fafc' : '#0b1220',
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  {activeFile.cid}
                </code>
              </Field>

              <Field label="Shared with">
                {activeFile.sharedWith.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {activeFile.sharedWith.map((s) => (
                      <span
                        key={s}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 999,
                          border: `1px solid ${t.border}`,
                          background: theme === 'light' ? '#fff' : t.mutedBg,
                          fontSize: 12,
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: t.subtext }}>No shares</span>
                )}
              </Field>

              <Field label="Permissions (mock)">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={pill(t)}>Read</span>
                  <span style={pill(t)}>Download</span>
                </div>
              </Field>
            </div>
          </aside>
        </>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes progressPulse {
          0% { transform: translateX(-30%); }
          50% { transform: translateX(10%); }
          100% { transform: translateX(100%); }
        }
        @media (max-width: 920px) {
          .layout-body {
            grid-template-columns: 1fr !important;
          }
          .layout-left {
            position: sticky;
            top: 52px;
            z-index: 5;
          }
        }
      `}</style>
    </div>
  )
}

/* ---------------------------------- */
/* Small presentational helpers                                           */
/* ---------------------------------- */

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{props.label}</div>
      <div>{props.children}</div>
    </div>
  )
}

const pill = (t: typeof lightTokens) =>
  ({
    padding: '4px 8px',
    borderRadius: 999,
    border: `1px solid ${t.border}`,
    background: '#0000',
    fontSize: 12,
  } as React.CSSProperties)

/* ---------------------------------- */
/* Styles (inline objects)                                                */
/* ---------------------------------- */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  btn: {
    appearance: 'none',
    padding: '8px 10px',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    fontSize: 12,
    fontWeight: 600,
  },
  body: {
    display: 'grid',
    gridTemplateColumns: '240px 1fr',
    alignItems: 'start',
    flex: 1,
  },
  left: {
    position: 'sticky',
    top: 52,
    height: 'calc(100vh - 52px)',
    display: 'flex',
    flexDirection: 'column',
    padding: 12,
    gap: 8,
  },
  leftHeader: {
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.3,
  },
  leftNav: {
    display: 'grid',
    gap: 6,
  },
  leftItem: {
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
  main: {
    padding: 16,
  },
  dropEmpty: {
    display: 'grid',
    placeItems: 'center',
    padding: 28,
    borderRadius: 12,
    textAlign: 'center',
    userSelect: 'none',
    cursor: 'pointer',
  },
  dropOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 12,
    pointerEvents: 'none',
  },
}
