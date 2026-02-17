import Document, { Html, Head, Main, NextScript } from 'next/document'

/**
 * _document.tsx
 *
 * Injects runtime configuration for IPFS bootstrap without relying on env vars.
 * Update the constant below to point to your local IPFS/libp2p bootstrap multiaddr.
 */
const IPFS_BOOTSTRAP_MULTIADDRS_CSV =
  '/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWMrUYgBsj3CtdXo7bxNf2Ahv5Vc5h85fV4SSg8banAXFw'
const IPFS_KUBO_API = 'http://127.0.0.1:5001'
const SJ_DEBUG = process.env.NEXT_PUBLIC_SJ_DEBUG === "true"

export default class MyDocument extends Document {
  render() {
    const runtimeConfig = {
      debug: SJ_DEBUG,
      ipfs: {
        bootstrapMultiaddrsCsv: IPFS_BOOTSTRAP_MULTIADDRS_CSV,
        kuboApiBaseUrl: IPFS_KUBO_API,
      },
    }

    return (
      <Html data-sj-config-json={JSON.stringify(runtimeConfig)}>
        <Head />
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}
