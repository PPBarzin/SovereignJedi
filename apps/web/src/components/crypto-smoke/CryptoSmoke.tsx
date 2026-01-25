import React, { useState, useRef } from "react";

/**
 * CryptoSmoke
 *
 * Small UI component to validate libsodium-wrappers-sumo runtime in a browser:
 * - dynamic import of libsodium-wrappers-sumo
 * - generate 1KB random plaintext
 * - generate a 32-byte fileKey and 24-byte nonce
 * - encrypt with XChaCha20-Poly1305 AEAD and provided AAD
 * - decrypt and compare bytes
 *
 * Usage: place component in a client page. Click "Run smoke" and watch logs / result.
 *
 * Notes:
 * - This intentionally fails hard if libsodium cannot be loaded.
 * - It runs entirely client-side (WASM load validation).
 */

export default function CryptoSmoke(): JSX.Element {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<null | "idle" | "ok" | "fail">("idle");
  const [logs, setLogs] = useState<string>("");
  const logRef = useRef<string>("");

  function appendLog(line: string) {
    const ts = new Date().toISOString();
    logRef.current = `${logRef.current}[${ts}] ${line}\n`;
    setLogs(logRef.current);
  }

  async function runSmokeTest() {
    setRunning(true);
    setResult("idle");
    logRef.current = "";
    setLogs("");

    try {
      appendLog("Starting Crypto smoke test — dynamic import libsodium-wrappers-sumo");

      // Dynamic import — required by the Task 4 constraints
      const mod = await import("libsodium-wrappers-sumo");
      const sodium = (mod && (mod as any).default) ? (mod as any).default : mod;

      appendLog("Imported libsodium module, awaiting sodium.ready...");
      await sodium.ready;
      appendLog("libsodium ready.");

      // 1) generate 1KB plaintext
      const PLAINTEXT_LEN = 1024;
      const plaintext = new Uint8Array(PLAINTEXT_LEN);
      if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(plaintext);
      } else {
        // fallback to libsodium random if browser random isn't available (very unlikely)
        const fallback = sodium.randombytes_buf(PLAINTEXT_LEN);
        plaintext.set(fallback);
      }
      appendLog(`Generated ${PLAINTEXT_LEN} bytes plaintext.`);

      // 2) generate fileKey and nonce via libsodium
      const fileKey = sodium.randombytes_buf(32); // 32 bytes
      const nonce = sodium.randombytes_buf(24); // 24 bytes for XChaCha20-Poly1305
      appendLog("Generated fileKey (32 bytes) and nonce (24 bytes) via libsodium.");

      // 3) AAD for AEAD (non-secret metadata)
      const aadObj = { smoke: true, ts: new Date().toISOString() };
      const aad = new TextEncoder().encode(JSON.stringify(aadObj));
      appendLog("Prepared AAD for AEAD.");

      // 4) encrypt
      appendLog("Encrypting with crypto_aead_xchacha20poly1305_ietf_encrypt...");
      const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintext,
        aad,
        null,
        nonce,
        fileKey
      );
      appendLog(`Ciphertext length: ${ciphertext.length} bytes.`);

      // 5) decrypt
      appendLog("Decrypting with crypto_aead_xchacha20poly1305_ietf_decrypt...");
      const recovered = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        aad,
        nonce,
        fileKey
      );

      if (!recovered) {
        appendLog("Decryption returned null/false — integrity check failed.");
        setResult("fail");
        setRunning(false);
        return;
      }

      // 6) compare
      let equal = true;
      if (recovered.length !== plaintext.length) equal = false;
      else {
        for (let i = 0; i < plaintext.length; i++) {
          if (plaintext[i] !== recovered[i]) {
            equal = false;
            break;
          }
        }
      }

      if (equal) {
        appendLog("Recovered plaintext matches original — SMOKE OK");
        setResult("ok");
      } else {
        appendLog("Recovered plaintext DOES NOT match original — SMOKE FAIL");
        setResult("fail");
      }
    } catch (err: any) {
      // Fail hard — show error message
      const msg = err && err.message ? err.message : String(err);
      appendLog(`ERROR: ${msg}`);
      setResult("fail");
    } finally {
      setRunning(false);
    }
  }

  function clearLogs() {
    logRef.current = "";
    setLogs("");
    setResult("idle");
  }

  return (
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, maxWidth: 640 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>Crypto smoke test (libsodium WASM)</h3>
      <p style={{ margin: "0 0 12px 0", color: "#444" }}>
        Validates that <code>libsodium-wrappers-sumo</code> loads in the browser and that XChaCha20-Poly1305 AEAD works at runtime.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={runSmokeTest}
          disabled={running}
          style={{
            padding: "8px 12px",
            background: running ? "#ddd" : "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Running..." : "Run crypto smoke"}
        </button>

        <button
          onClick={clearLogs}
          style={{
            padding: "8px 12px",
            background: "#f3f3f3",
            color: "#111",
            border: "1px solid #ccc",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Clear logs
        </button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Result:</strong>{" "}
        <span
          style={{
            color: result === "ok" ? "green" : result === "fail" ? "crimson" : "#666",
            fontWeight: 600,
          }}
        >
          {result === "ok" ? "SMOKE OK" : result === "fail" ? "SMOKE FAIL" : "idle"}
        </span>
      </div>

      <div>
        <textarea
          readOnly
          value={logs}
          rows={12}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 12,
            padding: 8,
            borderRadius: 6,
            border: "1px solid #e6e6e6",
            background: "#fafafa",
            resize: "vertical",
          }}
        />
      </div>
    </div>
  );
}
