import React, { useMemo, useEffect } from 'react'
import type { AppProps } from 'next/app'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'

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
 * - The RPC endpoint is derived from `NEXT_PUBLIC_SOLANA_CLUSTER` with a
 *   `devnet` fallback.
 */

export default function App({ Component, pageProps }: AppProps) {
  // Resolve cluster (client build-time env injection by Next)
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER as string) || 'devnet'

  // Stable endpoint for ConnectionProvider
  const endpoint = useMemo(() => clusterApiUrl(cluster as 'devnet' | 'mainnet-beta' | 'testnet'), [cluster])

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

  // Client-only mount for the Crypto smoke helper.
  // We dynamically import the client mount module so it is not included in SSR.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Dynamic import triggers the client-only mount helper which will attach the CryptoSmoke component
    // to the placeholder DOM node with id "crypto-smoke-root".
    import('../src/pages/_client_crypto_smoke').catch((err) => {
      // Expose the error to console for debugging; do not throw during render.
      console.error('Failed to mount client crypto smoke helper:', err);
    });
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          {/* Placeholder container for client-only Crypto smoke UI.
              The client mount helper dynamically imports and mounts the CryptoSmoke component into this node. */}
          <div id="crypto-smoke-root" style={{ marginTop: 12 }} />
          <Component {...pageProps} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
