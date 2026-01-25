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
  // 1) If a global sodium already exists, reuse it
  if (typeof (window as any).sodium !== "undefined") {
    const g = (window as any).sodium;
    appendLog(logRef, setLogs, "Found global window.sodium — awaiting ready...");
    if (g && g.ready) await g.ready;
    appendLog(logRef, setLogs, "window.sodium ready");
    return g;
  }

  // 2) Try dynamic import of libsodium-wrappers-sumo (local in node_modules)
  appendLog(logRef, setLogs, "Attempting dynamic import('libsodium-wrappers-sumo')...");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import("libsodium-wrappers-sumo");
    const sodium = (mod && (mod as any).default) ? (mod as any).default : mod;
    if (sodium && sodium.ready) await sodium.ready;
    appendLog(logRef, setLogs, "Imported libsodium-wrappers-sumo and sodium.ready resolved.");
    return sodium;
  } catch (err: any) {
    appendLog(logRef, setLogs, `Dynamic import failed: ${(err && err.message) || String(err)}`);
  }

  // 3) Optional CDN fallback when explicitly allowed
  if (allowCdn) {
    appendLog(logRef, setLogs, "ALLOW_CDN enabled — attempting to load libsodium from CDN...");
    // If already added script tag, wait for window.sodium
    const existing = document.querySelector('script[data-sj-libsodium="true"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = LIBSODIUM_CDN;
      script.async = true;
      script.setAttribute("data-sj-libsodium", "true");
      // Attach to head
      document.head.appendChild(script);
    } else {
      appendLog(logRef, setLogs, "CDN script tag already present; waiting for sodium global.");
    }

    // Wait for window.sodium.ready
    const start = Date.now();
    const timeoutMs = 15000;
    // Poll for window.sodium
    while (Date.now() - start < timeoutMs) {
      if ((window as any).sodium && (window as any).sodium.ready) {
        try {
          await (window as any).sodium.ready;
          appendLog(logRef, setLogs, "Loaded libsodium from CDN and sodium.ready resolved.");
          return (window as any).sodium;
        } catch (err) {
          appendLog(logRef, setLogs, `sodium.ready rejected: ${(err && err.message) || String(err)}`);
          break;
        }
      }
      // small delay
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
    appendLog(logRef, setLogs, "Timed out waiting for libsodium from CDN.");
  }

  // 4) Fail hard
  throw new Error(
    "libsodium-wrappers-sumo could not be loaded locally. Ensure 'libsodium-wrappers-sumo' is installed and resolvable by the app build. " +
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
