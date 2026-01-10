import React, { useMemo } from 'react'
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
 * - The MVP supports Phantom only (PhantomWalletAdapter). Additional adapters
 *   can be appended to the `wallets` array when expanding support.
 * - The RPC endpoint is derived from `NEXT_PUBLIC_SOLANA_CLUSTER` with a
 *   `devnet` fallback.
 */

export default function App({ Component, pageProps }: AppProps) {
  // Resolve cluster (client build-time env injection by Next)
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER as string) || 'devnet'

  // Stable endpoint for ConnectionProvider
  const endpoint = useMemo(() => clusterApiUrl(cluster as 'devnet' | 'mainnet-beta' | 'testnet'), [cluster])

  // Wallets list (Phantom-only in MVP)
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])

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
