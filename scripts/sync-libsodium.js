#!/usr/bin/env node

/**
 * sync-libsodium.js
 *
 * Reproducible copy script to synchronize the libsodium-wrappers-sumo bundle
 * into deterministic local locations used by the project:
 *
 * - packages/crypto/test-assets/libsodium
 * - apps/web/public/libsodium
 *
 * Requirements & behavior:
 * - Locates the installed `libsodium-wrappers-sumo` package via Node resolution.
 * - Detects a suitable distribution directory (e.g. `dist/modules-sumo` or `dist/modules-sumo-esm`).
 * - Verifies the package was found and prints its version for traceability.
 * - Copies the entire distribution directory to the two destinations above.
 * - Overwrites destinations atomically (remove then copy).
 * - Fails hard (non-zero exit) on any error so CI / dev flows notice the problem.
 *
 * Usage:
 *   node ./scripts/sync-libsodium.js
 *
 * Note:
 * - This script is intentionally conservative: it requires a proper installed
 *   libsodium-wrappers-sumo module in node_modules. It does NOT attempt to
 *   download or shim libsodium.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const MODULE_NAME = "libsodium-wrappers-sumo";
const CANDIDATE_DIST_DIRS = [
  "dist/modules-sumo",
  "dist/modules-sumo-esm",
  "dist/modules-sumo-wrappers",
];
const DESTINATIONS = [
  "packages/crypto/test-assets/libsodium",
  "apps/web/public/libsodium",
];

function log(...args) {
  console.log("[sync-libsodium]", ...args);
}

function err(...args) {
  console.error("[sync-libsodium][ERROR]", ...args);
}

async function pathExists(p) {
  try {
    await fsPromises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(dir) {
  // Node 16+ has rm with recursive option
  try {
    await fsPromises.rm(dir, { recursive: true, force: true });
  } catch (e) {
    // fallback to rmdir
    try {
      await fsPromises.rmdir(dir, { recursive: true });
    } catch {
      // ignore
    }
  }
}

async function copyRecursive(src, dest) {
  // Prefer fs.cp if available (Node 16.7+), else implement fallback
  if (fs.promises && typeof fs.promises.cp === "function") {
    // Use the native fs.promises.cp when available (Node 16.7+).
    await fs.promises.cp(src, dest, { recursive: true });
    return;
  }

  // Fallback: manual recursive copy
  await fsPromises.mkdir(dest, { recursive: true });
  const entries = await fsPromises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(s, d);
    } else if (entry.isSymbolicLink()) {
      const link = await fsPromises.readlink(s);
      try {
        await fsPromises.symlink(link, d);
      } catch {
        // ignore if symlink fails on platform
      }
    } else {
      await fsPromises.copyFile(s, d);
    }
  }
}

function findModuleRoot(resolvedPath) {
  // Walk up from resolvedPath to find package.json belonging to the module
  let dir = path.dirname(resolvedPath);
  const root = path.parse(dir).root;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg && pkg.name && pkg.name.includes("libsodium-wrappers")) {
          return { moduleRoot: dir, pkg };
        }
      } catch {
        // ignore parse errors, continue walking up
      }
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

async function main() {
  try {
    log("Starting libsodium sync...");

    // Resolve module entry. Use require.resolve in a try/catch manner.
    let resolved;
    try {
      // We attempt to resolve the package main file so we can find the module root.
      resolved = require.resolve(MODULE_NAME, { paths: [process.cwd()] });
    } catch (e) {
      // Try a second resolution without explicit paths
      try {
        resolved = require.resolve(MODULE_NAME);
      } catch (err) {
        err("Unable to resolve module", MODULE_NAME);
        err(
          "Ensure it is installed (pnpm add -w libsodium-wrappers-sumo --filter @sj/crypto)",
        );
        process.exit(2);
      }
    }

    const found = findModuleRoot(resolved);
    if (!found) {
      err(
        "Could not locate module root for",
        MODULE_NAME,
        "resolved path:",
        resolved,
      );
      process.exit(3);
    }

    const { moduleRoot, pkg } = found;
    log(`Found ${MODULE_NAME} at:`, moduleRoot);
    log(`Module version:`, pkg.version || "<unknown>");

    // Locate distribution directory
    let distDir = null;
    for (const cand of CANDIDATE_DIST_DIRS) {
      const candidate = path.join(moduleRoot, cand);
      if (fs.existsSync(candidate) && (await pathExists(candidate))) {
        distDir = candidate;
        break;
      }
    }

    if (!distDir) {
      err(
        "Could not find a libsodium distribution directory under the module root.",
      );
      err("Searched candidates:", CANDIDATE_DIST_DIRS.join(", "));
      process.exit(4);
    }

    log("Using distribution directory:", distDir);

    // Ensure destinations exist or remove & create
    const absDestinations = DESTINATIONS.map((d) =>
      path.join(process.cwd(), d),
    );
    for (const dest of absDestinations) {
      log("Preparing destination:", dest);
      if (await pathExists(dest)) {
        log("Removing existing destination:", dest);
        await rmrf(dest);
      }
      await fsPromises.mkdir(dest, { recursive: true });
    }

    // Copy distribution contents into each destination
    for (const dest of absDestinations) {
      log(`Copying ${distDir} -> ${dest} ...`);
      await copyRecursive(distDir, dest);
      log(`Copied to ${dest}`);
    }

    // Also emit a small metadata file to record which version was copied
    const meta = {
      module: MODULE_NAME,
      version: pkg.version || null,
      distDir: path.relative(process.cwd(), distDir),
      copiedAt: new Date().toISOString(),
    };

    for (const dest of absDestinations) {
      const metaPath = path.join(dest, "SYNC-METADATA.json");
      await fsPromises.writeFile(
        metaPath,
        JSON.stringify(meta, null, 2),
        "utf8",
      );
      log(`Wrote metadata to ${metaPath}`);
    }

    log("libsodium sync completed successfully.");
    process.exit(0);
  } catch (e) {
    err(
      "Unhandled error during libsodium sync:",
      e && e.message ? e.message : String(e),
    );
    process.exit(10);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
