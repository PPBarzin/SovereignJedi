/**
 * next.config.js
 *
 * Purpose:
 * - Disable Next.js ESLint checks during the build step for this app.
 *   This prevents the build from failing due to project-wide lint configuration
 *   differences during CI while still allowing local lint runs.
 *
 * Notes:
 * - We keep this intentionally simple. If you want to opt-in to linting during
 *   builds later, remove or toggle `ignoreDuringBuilds`.
 * - This file lives in apps/web and affects only that Next.js app.
 */
const path = require('path')
const libsodiumEntry = require.resolve('libsodium')
const libsodiumRoot = path.dirname(libsodiumEntry)

module.exports = {
  // Prevent Next from failing builds due to ESLint issues.
  // Local `pnpm -r lint` should still be run as part of CI before build.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Common Next.js defaults helpful for stability (can be adjusted later)
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    externalDir: true,
  },
  transpilePackages: ['@sj/crypto', '@sj/ipfs'],

  webpack: (config) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      './libsodium.mjs': path.resolve(libsodiumRoot, '../modules-esm/libsodium.mjs'),
    }
    return config
  },
}
