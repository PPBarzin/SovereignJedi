'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { useSession } from '../../lib/session/useSession'
import { getManifestCid, buildManifestStorageKey } from '@sj/manifest'
import { registryService } from '../../lib/solana/RegistryService'
import { getSolanaCluster } from '../../lib/solana/solanaConfig'

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '10px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    marginBottom: '16px',
    background: 'rgba(255, 255, 255, 0.03)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  header: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'rgba(255, 255, 255, 0.5)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '10px',
    fontWeight: 700,
  },
  btn: {
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 700,
    border: 'none',
    background: '#008fc7',
    color: 'white',
    fontSize: '12px',
    transition: 'all 0.2s ease',
  },
  btnDisabled: {
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'not-allowed',
    fontWeight: 700,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: '12px',
  },
  error: {
    fontSize: '11px',
    color: '#ef4444',
    marginTop: '4px',
  }
}

export const RegistryPublishWidget: React.FC = () => {
  const { walletPubKey, onChainRegistry, registryError, publishManifest } = useSession()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localManifestCid, setLocalManifestCid] = useState<string | null>(null)

  const SJ_DEBUG = String(process.env.NEXT_PUBLIC_SJ_DEBUG).toLowerCase() === 'true'

  useEffect(() => {
    if (!walletPubKey) {
      setLocalManifestCid(null)
      return
    }

    const refresh = () => {
      try {
        setLocalManifestCid(getManifestCid(walletPubKey))
      } catch {
        setLocalManifestCid(null)
      }
    }

    refresh()

    const handler = (e: any) => {
      // Optional: filter if necessary (e.g. check e.detail.walletPubKey)
      refresh()
    }

    window.addEventListener('sj:manifestCidChanged', handler)
    return () => {
      window.removeEventListener('sj:manifestCidChanged', handler)
    }
  }, [walletPubKey])

  const onChainLatestManifestCid = useMemo(() => {
    if (!onChainRegistry?.entries || onChainRegistry.entries.length === 0) return null
    const head = registryService.selectHead(onChainRegistry.entries)
    return head?.manifestCid ?? null
  }, [onChainRegistry])

  const status = useMemo(() => {
    let res = { label: 'Unknown', color: '#6b7280', bg: '#37415122' }

    if (!walletPubKey) {
      res = { label: 'Disconnected', color: '#6b7280', bg: '#37415122' }
    } else if (registryError) {
      res = { label: 'Network error', color: '#ef4444', bg: '#ef444422' }
    } else if (!onChainRegistry || onChainRegistry.entries.length === 0) {
      res = { label: 'Not published', color: '#f59e0b', bg: '#f59e0b22' }
    } else if (!localManifestCid) {
      res = { label: 'No local manifest', color: '#ef4444', bg: '#ef444422' }
    } else if (localManifestCid === onChainLatestManifestCid) {
      res = { label: 'Up to date', color: '#10b981', bg: '#10b98122' }
    } else {
      // Calculate behind count
      const localIndex = onChainRegistry.entries.findIndex(e => e.manifestCid === localManifestCid)
      if (localIndex === -1) {
        // Local CID is not even in the registry
        res = { label: 'Out of sync', color: '#3b82f6', bg: '#3b82f622' }
      } else {
        // Simple heuristic: if local is in entries but not the latest (head), it's behind.
        res = { label: 'Published (behind)', color: '#3b82f6', bg: '#3b82f622' }
      }
    }

    if (SJ_DEBUG) {
      console.log("[SJ_DEBUG][RegistryStatus]", {
        cluster: getSolanaCluster(),
        wallet: walletPubKey,
        storageKeyUsed: walletPubKey ? buildManifestStorageKey(walletPubKey) : null,
        localCid: localManifestCid,
        headCid: onChainLatestManifestCid,
        entriesLen: onChainRegistry?.entries?.length ?? 0,
        status: res.label,
      });
    }

    return res
  }, [walletPubKey, onChainRegistry, registryError, localManifestCid, onChainLatestManifestCid, SJ_DEBUG])

  const canPublish = useMemo(() => {
    return !!walletPubKey && !!localManifestCid && localManifestCid !== onChainLatestManifestCid && !loading && !registryError
  }, [walletPubKey, localManifestCid, onChainLatestManifestCid, loading, registryError])

  const handlePublish = async () => {
    if (!localManifestCid) return
    setLoading(true)
    setError(null)
    try {
      if (SJ_DEBUG) {
        console.log('[SJ-DEBUG][Registry] Publishing manifest...', { cid: localManifestCid })
      }
      const sig = await publishManifest(localManifestCid)
      if (SJ_DEBUG) {
        console.log('[SJ-DEBUG][Registry] Publish success', { signature: sig, cid: localManifestCid })
      }
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Solana Registry
        <span style={{ ...styles.badge, color: status.color, background: status.bg }}>
          {status.label}
        </span>
      </div>
      
      <button 
        onClick={handlePublish}
        disabled={!canPublish}
        style={canPublish ? styles.btn : styles.btnDisabled}
      >
        {loading ? 'Publishing...' : 'Publish to Solana'}
      </button>

      {error && <div style={styles.error}>Error: {error}</div>}
    </div>
  )
}
