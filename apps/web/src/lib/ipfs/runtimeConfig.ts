export type IpfsRuntimeConfig = {
  /**
   * CSV string of bootstrap multiaddrs.
   * Example: /ip4/127.0.0.1/tcp/15002/ws/p2p/<PEER_ID>
   */
  bootstrapMultiaddrsCsv?: string
}

type RuntimeConfigShape = {
  ipfs?: IpfsRuntimeConfig
}

declare global {
  interface Window {
    __SJ_CONFIG__?: RuntimeConfigShape
  }
}

const DEFAULT_CONFIG: IpfsRuntimeConfig = {}

/**
 * Resolve IPFS runtime configuration from a client-side configuration object.
 *
 * Priority:
 * 1) window.__SJ_CONFIG__.ipfs (global injected config)
 * 2) data-sj-config-json attribute on <html> (stringified JSON)
 * 3) data-sj-ipfs-bootstrap attribute on <html> (CSV string)
 *
 * This is intentionally client-only and does NOT read environment variables.
 */
export function getIpfsRuntimeConfig(): IpfsRuntimeConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_CONFIG }

  // 1) Global config object (preferred)
  const globalCfg = window.__SJ_CONFIG__?.ipfs
  if (globalCfg) {
    return {
      ...DEFAULT_CONFIG,
      ...globalCfg,
    }
  }

  // 2) <html data-sj-config-json="...">
  const htmlEl = document.documentElement
  const jsonAttr = htmlEl.getAttribute('data-sj-config-json')
  if (jsonAttr) {
    try {
      const parsed = JSON.parse(jsonAttr) as RuntimeConfigShape
      if (parsed?.ipfs) {
        return {
          ...DEFAULT_CONFIG,
          ...parsed.ipfs,
        }
      }
    } catch {
      // Ignore invalid JSON and fall through to other sources
    }
  }

  // 3) <html data-sj-ipfs-bootstrap="...">
  const csvAttr = htmlEl.getAttribute('data-sj-ipfs-bootstrap')
  if (csvAttr) {
    return {
      ...DEFAULT_CONFIG,
      bootstrapMultiaddrsCsv: csvAttr,
    }
  }

  return { ...DEFAULT_CONFIG }
}

/**
 * Normalize the runtime config into an array of multiaddrs.
 */
export function getIpfsBootstrapList(config: IpfsRuntimeConfig = getIpfsRuntimeConfig()): string[] {
  const raw = (config.bootstrapMultiaddrsCsv ?? '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
