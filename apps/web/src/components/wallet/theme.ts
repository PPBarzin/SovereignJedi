/**
 * Shared theme tokens for wallet UI components
 * Path: apps/web/src/components/wallet/theme.ts
 *
 * Purpose:
 * - Centralize color tokens used by wallet-related components (ConnectWallet, VerifyWallet, IdentityStatus).
 * - Provide a small helper to convert hex -> rgba (useful for subtle borders/shadows).
 *
 * Usage:
 * import { darkTokens, lightTokens, getTokens, withAlpha, ThemeMode } from './theme'
 *
 * Then consume tokens in inline styles:
 * const t = getTokens('dark')
 * <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }} />
 */

export type ThemeMode = 'light' | 'dark'

export interface WalletThemeTokens {
  // global
  pageBg: string
  text: string
  subtext: string
  border: string
  panelBg: string
  headerBg: string
  headerFg: string
  mutedBg: string
  mutedFg: string
  accent: string
  accent2: string
  focusRing: string

  // semantic
  ok: string
  warn: string
  danger: string

  // cards / panels
  cardBg: string
  cardBorder: string
  cardInverseBg: string

  // buttons
  btnPrimaryBg: string
  btnPrimaryText: string
  btnPrimaryBorder: string

  btnMutedBg: string
  btnMutedText: string
  btnMutedBorder: string

  // small UI tweaks
  subtleBorder: string
  metaBg: string
  metaBorder: string
  metaText: string
}

/**
 * Dark theme tokens (primary target for the app)
 */
export const darkTokens: WalletThemeTokens = {
  pageBg: '#0b1220',
  text: '#e6f6ff',
  subtext: '#9fbfd6',
  border: '#223241',
  panelBg: '#0f1724',
  headerBg: 'rgba(14, 23, 42, 0.9)',
  headerFg: '#e2eef6',
  mutedBg: '#0b1220',
  mutedFg: '#94a3b8',
  accent: '#22d3ee',
  accent2: '#a78bfa',
  focusRing: 'rgba(34,211,238,0.12)',

  ok: '#46c6a6',
  warn: '#f6b26b',
  danger: '#ff8b88',

  cardBg: '#07182b', // slightly lighter than pageBg to pop
  cardBorder: 'rgba(255,255,255,0.04)',
  cardInverseBg: '#0b2a42',

  btnPrimaryBg: '#0aa88f',
  btnPrimaryText: '#ffffff',
  btnPrimaryBorder: 'rgba(0,0,0,0.08)',

  btnMutedBg: 'transparent',
  btnMutedText: '#dff6ff',
  btnMutedBorder: 'rgba(255,255,255,0.06)',

  subtleBorder: 'rgba(255,255,255,0.03)',
  metaBg: '#0b2a42',
  metaBorder: 'rgba(255,255,255,0.03)',
  metaText: '#e6f6ff',
}

/**
 * Light theme tokens (kept minimal for parity)
 */
export const lightTokens: WalletThemeTokens = {
  pageBg: '#f8fafc',
  text: '#0f172a',
  subtext: '#475569',
  border: '#e2e8f0',
  panelBg: '#ffffff',
  headerBg: '#ffffff',
  headerFg: '#0f172a',
  mutedBg: '#f1f5f9',
  mutedFg: '#64748b',
  accent: '#0ea5e9',
  accent2: '#a78bfa',
  focusRing: 'rgba(14,165,233,0.12)',

  ok: '#10b981',
  warn: '#eab308',
  danger: '#ef4444',

  cardBg: '#ffffff',
  cardBorder: '#e6e6e6',
  cardInverseBg: '#fafafa',

  btnPrimaryBg: '#0366d6',
  btnPrimaryText: '#ffffff',
  btnPrimaryBorder: '#0b4db2',

  btnMutedBg: '#f1f5f9',
  btnMutedText: '#0f172a',
  btnMutedBorder: '#e6e6e6',

  subtleBorder: '#f0f4f8',
  metaBg: '#fafafa',
  metaBorder: '#f0f0f0',
  metaText: '#222222',
}

/**
 * Helper to get tokens by mode
 */
export function getTokens(mode: ThemeMode): WalletThemeTokens {
  return mode === 'light' ? lightTokens : darkTokens
}

/**
 * Convert a hex color to an rgba() string with the specified alpha.
 * Accepts: '#RRGGBB' or '#RGB'
 */
export function withAlpha(hex: string, alpha: number): string {
  if (!hex) return `rgba(0,0,0,${alpha})`
  const clean = hex.replace('#', '').trim()
  let r = 0
  let g = 0
  let b = 0

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16)
    g = parseInt(clean[1] + clean[1], 16)
    b = parseInt(clean[2] + clean[2], 16)
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16)
    g = parseInt(clean.slice(2, 4), 16)
    b = parseInt(clean.slice(4, 6), 16)
  } else {
    // fallback
    return `rgba(0,0,0,${alpha})`
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default {
  darkTokens,
  lightTokens,
  getTokens,
  withAlpha,
}
