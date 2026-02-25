import React, { useMemo, useEffect } from 'react'
import type { AppProps } from 'next/app'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { getSolanaRpcUrl } from '../src/lib/solana/solanaConfig'
import '../src/lib/solana/solanaConfig' // force initialization logs

// Wallet adapter UI styles (minimal). This package exports a small CSS file
// required for the WalletModal and WalletMultiButton to render correctly.
// Keep this import so the modal/button styles are available app-wide.
import '@solana/wallet-adapter-react-ui/styles.css'

/**
 * App wrapper that provides Solana wallet adapters globally.
 *
 * Why here:
 * - The wallet-adapter expects the app to be wrapped with ConnectionProvider +
 *   WalletProvider. Placing them in `_app.tsx` (pages router) ensures every page
 *   has access to `useWallet()` and that UI components like `WalletMultiButton`
 *   and `WalletModalProvider` behave correctly.
 *
 * - We intentionally include `WalletModalProvider` so the standard modal UI used
 *   by `@solana/wallet-adapter-react-ui` is available. This prevents the
 *   `WalletNotSelectedError` that arises when calling `wallet.connect()` while
 *   no wallet has been selected by the user.
 *
 * Notes:
 * - The MVP registers Phantom as a Standard Wallet via `getPhantomWallet()` to
 *   avoid duplicate registrations (do not instantiate both PhantomWalletAdapter
 *   and the Standard Wallet for Phantom). This keeps the modal free of duplicate
 *   entries and silences the console warning about duplicate registration.
 * - The RPC endpoint is derived from centralized solanaConfig.
 */

export default function App({ Component, pageProps }: AppProps) {
  // Stable endpoint for ConnectionProvider
  const endpoint = useMemo(() => getSolanaRpcUrl(), [])

  // Wallets list (Phantom-only in MVP)
  // Strategy:
  // - If a Phantom extension is present (window.solana?.isPhantom) the extension
  //   already exposes Phantom as a standard wallet entry; to avoid duplicate
  //   registrations and console warnings we skip registering the adapter.
  // - Otherwise, register the Phantom adapter so users without the extension can
  //   still be offered Phantom through adapter flows.
  const wallets = useMemo(() => {
    if (typeof window !== 'undefined' && (window as any).solana && (window as any).solana.isPhantom) {
      // Extension will appear in the modal as a standard wallet; do not register adapter
      return []
    }
    return [new PhantomWalletAdapter()]
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).sodium && (window as any).sodium.ready) {
      void (window as any).sodium.ready.catch(() => {})
      return
    }

    const sumoSrc = '/libsodium/libsodium-sumo.js'
    const wrappersSrc = '/libsodium/libsodium-wrappers.js'

    const injectScript = (src: string, attr: string) =>
      new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[${attr}="true"]`) as HTMLScriptElement | null
        if (existing) {
          if (existing.dataset.sjLoaded === '1') {
            resolve()
            return
          }
          existing.addEventListener('load', () => resolve(), { once: true })
          existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
          return
        }

        const script = document.createElement('script')
        script.src = src
        script.async = true
        script.setAttribute(attr, 'true')
        script.onload = () => {
          script.dataset.sjLoaded = '1'
          resolve()
        }
        script.onerror = () => reject(new Error(`Failed to load ${src}`))
        document.head.appendChild(script)
      })

    void (async () => {
      try {
        await injectScript(sumoSrc, 'data-sj-libsodium-sumo')
        await injectScript(wrappersSrc, 'data-sj-libsodium-wrappers')
        if ((window as any).sodium && (window as any).sodium.ready) {
          await (window as any).sodium.ready
        }
      } catch (e) {
        console.error('[crypto] libsodium preload failed', e)
      }
    })()
  }, [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <Component {...pageProps} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
