"use client";

import React, { useEffect } from "react";

/**
 * Client-only mount helper for the CryptoSmoke component.
 *
 * This file dynamically imports the CryptoSmoke component and mounts it into
 * the DOM element with id "crypto-smoke-root" (created in the page).
 *
 * Reasoning:
 * - We keep CryptoSmoke out of SSR bundle and load libsodium only in the browser.
 * - Dynamic import + react-dom/client createRoot ensures the component hydrates
 *   correctly in a client environment.
 *
 * Usage:
 * - Include <div id="crypto-smoke-root"></div> in the page markup (already added).
 * - This component should be referenced/imported from a client-side entry (e.g. a page).
 *
 * Safety:
 * - Any error while importing or mounting is caught and logged; the container will
 *   show an error message for easier debugging.
 */

const CONTAINER_ID = "crypto-smoke-root";

export default function ClientCryptoSmoke(): null {
  useEffect(() => {
    let root: any = null;
    let mounted = false;

    async function mount() {
      const container = document.getElementById(CONTAINER_ID);
      if (!container) {
        // Nothing to mount into (page may not include the placeholder)
        return;
      }

      try {
        // Dynamic import of the client component so that libsodium (WASM) and the
        // smoke UI are only pulled into the browser bundle when needed.
        const mod = await import("../components/crypto-smoke/CryptoSmoke");
        const CryptoSmoke = (mod && (mod as any).default) ? (mod as any).default : mod;

        // Import react-dom client API dynamically to avoid SSR usage.
        const rdom = await import("react-dom/client");
        const createRoot = (rdom as any).createRoot;

        // Create root and render
        root = createRoot(container);
        root.render(React.createElement(CryptoSmoke));
        mounted = true;
      } catch (err: any) {
        // Fail hard in the sense of surface the error to the UI for debugging,
        // but don't throw during hydration which would break the page.
        console.error("Failed to mount CryptoSmoke:", err);
        try {
          const container = document.getElementById(CONTAINER_ID);
          if (container) {
            container.innerText = `Crypto smoke failed to load: ${err?.message ?? String(err)}`;
          }
        } catch {
          // ignore UI fallback errors
        }
      }
    }

    mount();

    return () => {
      try {
        if (root && mounted) {
          root.unmount();
        }
      } catch {
        // ignore unmount errors
      }
    };
  }, []);

  // This component renders nothing itself; it mounts into the existing DOM node.
  return null;
}
