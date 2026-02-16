"use client";

import React, { useState, useRef } from "react";

/**
 * /dev/crypto-smoke
 *
 * Dev-only page to validate libsodium-wrappers-sumo runtime in the browser.
 *
 * Access gated by environment variable: NEXT_PUBLIC_ENABLE_SMOKE must equal "1"
 * CDN fallback is disabled by default; enable with NEXT_PUBLIC_SMOKE_ALLOW_CDN="1"
 *
 * Behavior:
 * - Attempt to load `libsodium-wrappers-sumo` via dynamic import (local, from node_modules).
 * - If import fails and NEXT_PUBLIC_SMOKE_ALLOW_CDN === "1", attempt to load the JS bundle
 *   from jsDelivr and wait for window.sodium.ready.
 * - If libsodium is present, run a 1KB encrypt/decrypt test using XChaCha20-Poly1305 AEAD.
 * - Shows logs and final OK/FAIL.
 *
 * Notes:
 * - This page is intended for developer validation of the browser runtime delivery of libsodium.
 * - It will fail with a clear error if libsodium cannot be loaded locally (and CDN is disabled).
 */

const ENABLE_SMOKE = process.env.NEXT_PUBLIC_ENABLE_SMOKE === "1";
const ALLOW_CDN = process.env.NEXT_PUBLIC_SMOKE_ALLOW_CDN === "1";
// Pin the CDN version only for optional fallback (not used by default)
const LIBSODIUM_CDN =
  "https://cdn.jsdelivr.net/npm/libsodium-wrappers-sumo@0.7.16/dist/modules-sumo/libsodium-wrappers.js";

// Local (no CDN) UMD bundles served from /public.
// IMPORTANT: in a browser <script> context, libsodium-wrappers.js expects to resolve `libsodium-sumo`
// via AMD/CommonJS. To make local load deterministic, we explicitly inject the `libsodium-sumo.js`
// UMD bundle FIRST, then inject `libsodium-wrappers.js` so it can attach `window.sodium`.
const LIBSODIUM_LOCAL_SUMO_JS = "/libsodium/libsodium-sumo.js";
const LIBSODIUM_LOCAL_WRAPPERS_JS = "/libsodium/libsodium-wrappers.js";

function appendLog(ref: React.MutableRefObject<string>, setter: (s: string) => void, line: string) {
  const ts = new Date().toISOString();
  ref.current = `${ref.current}[${ts}] ${line}\n${ref.current}`;
  setter(ref.current);
}

function equalUint8(a?: Uint8Array | null, b?: Uint8Array | null): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Attempt to import libsodium-wrappers-sumo from node_modules.
 * If that fails and ALLOW_CDN is true, attempt to load the CDN script and wait for window.sodium.
 * If neither works, throw a descriptive error (fail hard).
 */
async function loadSodium(allowCdn: boolean, logRef: React.MutableRefObject<string>, setLogs: (s: string) => void) {
  const getWinSodium = () => (window as any).sodium;

  // Diagnostics: presence at entry
  appendLog(logRef, setLogs, `window.sodium present: ${getWinSodium() ? "YES" : "NO"}`);

  // 1) If a global sodium already exists, reuse it
  if (typeof getWinSodium() !== "undefined" && getWinSodium()) {
    const g = getWinSodium();
    appendLog(logRef, setLogs, "Found global window.sodium — awaiting ready...");
    if (g && g.ready) {
      await g.ready;
      appendLog(logRef, setLogs, "ready awaited: YES (global)");
    } else {
      appendLog(logRef, setLogs, "ready awaited: NO (global had no ready)");
    }
    appendLog(logRef, setLogs, "window.sodium ready (global)");
    (globalThis as any).sodium = g;
    return g;
  }

  // 2) Local load MUST succeed without CDN for OQ-07:
  //    We inject libsodium-sumo.js FIRST, then libsodium-wrappers.js (both from /public),
  //    then we wait for window.sodium.ready to resolve.
  appendLog(logRef, setLogs, `Attempting to load local libsodium UMD bundle (sumo): ${LIBSODIUM_LOCAL_SUMO_JS}`);
  appendLog(logRef, setLogs, `Attempting to load local libsodium UMD bundle (wrappers): ${LIBSODIUM_LOCAL_WRAPPERS_JS}`);

  async function injectScriptOnce(opts: { src: string; attr: string }) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[${opts.attr}="true"]`) as HTMLScriptElement | null;
      if (existing) return resolve();

      const script = document.createElement("script");
      script.src = opts.src;
      script.async = true;
      script.defer = true;
      script.setAttribute(opts.attr, "true");
      script.onload = () => resolve();
      script.onerror = (e) => reject(new Error(`Failed to load local script ${opts.src}: ${String(e)}`));
      document.head.appendChild(script);
    });
  }

  try {
    // Ensure sumo core is loaded first
    await injectScriptOnce({ src: LIBSODIUM_LOCAL_SUMO_JS, attr: "data-sj-libsodium-sumo-local" });
    appendLog(logRef, setLogs, "Local libsodium-sumo.js injected (or already present).");

    // Then load wrappers which attach window.sodium
    await injectScriptOnce({ src: LIBSODIUM_LOCAL_WRAPPERS_JS, attr: "data-sj-libsodium-wrappers-local" });
    appendLog(logRef, setLogs, "Local libsodium-wrappers.js injected (or already present).");

    // Poll for window.sodium + sodium.ready
    const start = Date.now();
    const timeoutMs = 15000;

    while (Date.now() - start < timeoutMs) {
      const s = getWinSodium();
      if (s) {
        appendLog(logRef, setLogs, "window.sodium present after local script load: YES");

        // Explicit attach (requirement)
        (globalThis as any).sodium = s;
        (window as any).sodium = s;

        if (s.ready) {
          try {
            await s.ready;
            appendLog(logRef, setLogs, "ready awaited: YES (local UMD)");
            appendLog(logRef, setLogs, "Loaded libsodium locally and sodium.ready resolved.");
            return s;
          } catch (e: any) {
            appendLog(logRef, setLogs, `sodium.ready rejected (local UMD): ${((e && e.message) || String(e))}`);
            break;
          }
        } else {
          appendLog(logRef, setLogs, "window.sodium present but .ready missing — waiting...");
        }
      }

      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error("Timed out waiting for local libsodium to attach window.sodium and resolve sodium.ready");
  } catch (errLocal: any) {
    appendLog(
      logRef,
      setLogs,
      `Local static load failed: ${(((errLocal as any) && (errLocal as any).message) || String(errLocal))}`
    );

    // CDN fallback only when explicitly allowed by env var
    if (ALLOW_CDN) {
      appendLog(logRef, setLogs, "ALLOW_CDN enabled — attempting CDN fallback...");
      try {
        const existing = document.querySelector('script[data-sj-libsodium="true"]');
        if (!existing) {
          const script = document.createElement("script");
          script.src = LIBSODIUM_CDN;
          script.async = true;
          script.setAttribute("data-sj-libsodium", "true");
          document.head.appendChild(script);
        }

        const start = Date.now();
        const timeoutMs = 15000;
        while (Date.now() - start < timeoutMs) {
          const s = getWinSodium();
          if (s && s.ready) {
            try {
              await s.ready;
              (globalThis as any).sodium = s;
              appendLog(logRef, setLogs, "ready awaited: YES (CDN)");
              appendLog(logRef, setLogs, "Loaded libsodium from CDN and sodium.ready resolved.");
              return s;
            } catch (e) {
              appendLog(logRef, setLogs, `sodium.ready rejected (CDN): ${(((e as any) && (e as any).message) || String(e))}`);
              break;
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 100));
        }
        appendLog(logRef, setLogs, "Timed out waiting for libsodium from CDN.");
      } catch (errCdn: any) {
        appendLog(logRef, setLogs, `CDN load attempt failed: ${(((errCdn as any) && (errCdn as any).message) || String(errCdn))}`);
      }
    } else {
      appendLog(logRef, setLogs, "CDN fallback disabled (NEXT_PUBLIC_SMOKE_ALLOW_CDN!=1).");
    }
  }

  // 3) Optional CDN fallback when explicitly allowed
  if (allowCdn) {
    appendLog(logRef, setLogs, "ALLOW_CDN enabled — attempting to load libsodium from CDN...");
    const existing = document.querySelector('script[data-sj-libsodium="true"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = LIBSODIUM_CDN;
      script.async = true;
      script.setAttribute("data-sj-libsodium", "true");
      document.head.appendChild(script);
    } else {
      appendLog(logRef, setLogs, "CDN script tag already present; waiting for sodium global.");
    }

    const start = Date.now();
    const timeoutMs = 15000;
    while (Date.now() - start < timeoutMs) {
      const s = getWinSodium();
      if (s && s.ready) {
        try {
          await s.ready;
          (globalThis as any).sodium = s;
          appendLog(logRef, setLogs, "ready awaited: YES (CDN optional)");
          appendLog(logRef, setLogs, "Loaded libsodium from CDN and sodium.ready resolved.");
          return s;
        } catch (err) {
          appendLog(logRef, setLogs, `sodium.ready rejected: ${(((err as any) && (err as any).message) || String(err))}`);
          break;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
    appendLog(logRef, setLogs, "Timed out waiting for libsodium from CDN.");
  }

  // 4) Fail hard
  throw new Error(
    "libsodium-wrappers-sumo could not be loaded locally. Ensure apps/web/public/libsodium contains BOTH libsodium-sumo.js and libsodium-wrappers.js so the UMD wrapper can attach window.sodium. " +
      (allowCdn ? "CDN fallback attempted but failed." : "CDN fallback disabled. Set NEXT_PUBLIC_SMOKE_ALLOW_CDN=1 to allow CDN fallback.")
  );
}

export default function CryptoSmokePage(): JSX.Element {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "fail">("idle");
  const [logs, setLogs] = useState<string>("");
  const logRef = useRef<string>("");

  const showDisabled = !ENABLE_SMOKE;

  async function runSmoke() {
    logRef.current = "";
    setLogs("");
    setStatus("idle");

    if (showDisabled) {
      appendLog(logRef, setLogs, "Smoke disabled — set NEXT_PUBLIC_ENABLE_SMOKE=1 to enable.");
      setStatus("fail");
      return;
    }

    setRunning(true);
    appendLog(logRef, setLogs, "Starting crypto smoke test (1KB) — libsodium-only flow");

    try {
      const sodium = await loadSodium(ALLOW_CDN, logRef, setLogs);
      appendLog(logRef, setLogs, "libsodium ready — proceeding with AEAD test");

      // Generate 1KB plaintext deterministically via Web Crypto
      const PLAINTEXT_LEN = 1024;
      const plaintext = new Uint8Array(PLAINTEXT_LEN);
      if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(plaintext);
        appendLog(logRef, setLogs, "Generated plaintext via window.crypto.getRandomValues");
      } else {
        const random = sodium.randombytes_buf(PLAINTEXT_LEN);
        plaintext.set(random);
        appendLog(logRef, setLogs, "Generated plaintext via sodium.randombytes_buf");
      }

      // fileKey and nonce via libsodium
      const fileKey = sodium.randombytes_buf(32);
      const nonce = sodium.randombytes_buf(24);
      appendLog(logRef, setLogs, "Generated fileKey (32) and nonce (24) via libsodium");

      // AAD (non-sensitive metadata)
      const aadObj = { smoke: true, ts: new Date().toISOString() };
      const aad = new TextEncoder().encode(JSON.stringify(aadObj));

      // encrypt
      appendLog(logRef, setLogs, "Encrypting using crypto_aead_xchacha20poly1305_ietf_encrypt...");
      const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintext,
        aad,
        null,
        nonce,
        fileKey
      );
      appendLog(logRef, setLogs, `Ciphertext length: ${ciphertext.length}`);

      // decrypt
      appendLog(logRef, setLogs, "Decrypting using crypto_aead_xchacha20poly1305_ietf_decrypt...");
      const recovered = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        aad,
        nonce,
        fileKey
      );

      if (!recovered) {
        appendLog(logRef, setLogs, "Decryption returned null/false — integrity failure");
        setStatus("fail");
        setRunning(false);
        return;
      }

      // Compare
      if (equalUint8(recovered, plaintext)) {
        appendLog(logRef, setLogs, "Recovered plaintext equals original — SMOKE OK");
        setStatus("ok");
      } else {
        appendLog(logRef, setLogs, "Recovered plaintext DOES NOT match original — SMOKE FAIL");
        setStatus("fail");
      }
    } catch (err: any) {
      appendLog(logRef, setLogs, `ERROR: ${(err && err.message) || String(err)}`);
      setStatus("fail");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto", color: "#0f172a" }}>
      <h1>Dev Crypto Smoke</h1>

      <section style={{ marginBottom: 12 }}>
        <strong>Gate:</strong>{" "}
        <span style={{ fontWeight: 600 }}>{showDisabled ? "DISABLED (NEXT_PUBLIC_ENABLE_SMOKE!=1)" : "ENABLED"}</span>
        <div style={{ marginTop: 8, color: "#334155" }}>
          <div>CDN fallback allowed: {ALLOW_CDN ? "yes" : "no (default)"}</div>
          <div style={{ marginTop: 6 }}>
            This dev page attempts to load <code>libsodium-wrappers-sumo</code> from local node_modules first.
            It will fail if libsodium is not available locally (recommended). Enable CDN fallback with{" "}
            <code>NEXT_PUBLIC_SMOKE_ALLOW_CDN=1</code>.
          </div>
        </div>
      </section>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={runSmoke}
          disabled={running || showDisabled}
          style={{
            padding: "8px 12px",
            background: running || showDisabled ? "#94a3b8" : "#0ea5e9",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: running || showDisabled ? "default" : "pointer",
          }}
        >
          {running ? "Running..." : "Run smoke (1KB AEAD)"}
        </button>

        <button
          onClick={() => {
            logRef.current = "";
            setLogs("");
            setStatus("idle");
          }}
          style={{
            padding: "8px 12px",
            background: "#f3f4f6",
            border: "1px solid #e6e6e6",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Result:</strong>{" "}
        <span style={{ fontWeight: 700, color: status === "ok" ? "green" : status === "fail" ? "crimson" : "#64748b" }}>
          {status === "ok" ? "OK" : status === "fail" ? "FAIL" : "idle"}
        </span>
      </div>

      <textarea
        readOnly
        value={logs}
        rows={16}
        style={{
          width: "100%",
          fontFamily: "monospace",
          fontSize: 12,
          padding: 8,
          borderRadius: 6,
          border: "1px solid #e6e6e6",
          background: "#fff",
          resize: "vertical",
        }}
      />
      <div style={{ marginTop: 10, color: "#475569" }}>
        <h4 style={{ margin: "8px 0" }}>How to use</h4>
        <ol>
          <li>
            Set environment: <code>NEXT_PUBLIC_ENABLE_SMOKE=1</code> (and optionally{" "}
            <code>NEXT_PUBLIC_SMOKE_ALLOW_CDN=1</code>).
          </li>
          <li>Start dev server: <code>pnpm -C apps/web dev</code></li>
          <li>Open <code>/dev/crypto-smoke</code> and click <em>Run smoke</em>.</li>
          <li>Expected: the component loads libsodium (local), runs encrypt/decrypt and shows <strong>OK</strong>.</li>
        </ol>
      </div>
    </div>
  );
}
