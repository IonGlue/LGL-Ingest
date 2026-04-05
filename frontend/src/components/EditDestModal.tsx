import { useState } from 'react'
import { X, Copy, Eye, EyeOff } from 'lucide-react'
import { api, type Destination } from '../api.js'

const C = {
  panel: '#FFFFFF', raised: '#E5E5EA', textPrimary: '#1A1A2E',
  textSub: '#555566', textMuted: '#8E8E9F', violet: '#8B5CF6',
  live: '#10B981', error: '#EF4444',
}

const STATUS_COLOR: Record<string, string> = {
  active: C.live, waiting: '#F59E0B', error: C.error, idle: C.textMuted,
}

interface Props {
  dest: Destination
  onClose: () => void
  onUpdated: () => void
  onNavigate?: (view: string) => void
}

export default function EditDestModal({ dest, onClose, onUpdated, onNavigate }: Props) {
  const [name, setName] = useState(dest.name)
  const [busy, setBusy] = useState(false)
  const [showUrl, setShowUrl] = useState(false)
  const [copied, setCopied] = useState(false)

  const statusColor = STATUS_COLOR[dest.status] ?? C.textMuted
  const isRtmp = dest.dest_type === 'rtmp'
  const url = (dest.config?.url as string) ?? ''

  function maskUrl(u: string): string {
    const parts = u.split('/')
    const key = parts[parts.length - 1]
    if (!key || key.length < 8) return u
    return parts.slice(0, -1).join('/') + '/' + key.slice(0, 4) + '••••' + key.slice(-4)
  }

  async function saveName() {
    if (name === dest.name) return
    setBusy(true)
    try { await api.updateDest(dest.id, { name }); onUpdated() } catch (e) { console.error(e) }
    finally { setBusy(false) }
  }

  async function handleStart() {
    try { await api.startDest(dest.id); onUpdated() } catch (e) { console.error(e) }
  }

  async function handleStop() {
    try { await api.stopDest(dest.id); onUpdated() } catch (e) { console.error(e) }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: C.panel, borderRadius: 10, width: 420, padding: 24, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, fontFamily: 'Syne, sans-serif', flex: 1 }}>
            Edit Destination
          </span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, marginRight: 8 }} />
          <span style={{ fontSize: 11, color: statusColor, textTransform: 'capitalize', marginRight: 12 }}>{dest.status}</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
            <X size={18} color={C.textMuted} />
          </button>
        </div>

        <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Name</label>
        <input
          value={name} onChange={e => setName(e.target.value)} onBlur={saveName}
          style={{ width: '100%', background: '#FAFAFA', border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, marginBottom: 14, boxSizing: 'border-box' }}
        />

        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>
          Type: <span style={{ color: C.textPrimary, fontWeight: 500 }}>{dest.dest_type.replace(/_/g, ' ')}</span>
        </div>

        {isRtmp && url && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Destination URL</label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#F5F5F8', borderRadius: 6, padding: '8px 12px',
              fontFamily: 'Courier New, monospace', fontSize: 11,
              border: `1px solid ${C.raised}`,
            }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {showUrl ? url : maskUrl(url)}
              </span>
              <button onClick={() => setShowUrl(!showUrl)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                {showUrl ? <EyeOff size={13} color={C.textMuted} /> : <Eye size={13} color={C.textMuted} />}
              </button>
              <button onClick={() => copyText(url)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                <Copy size={13} color={copied ? C.live : C.textMuted} />
              </button>
            </div>
          </div>
        )}

        {!isRtmp && (
          <div style={{ marginBottom: 14, fontSize: 12, color: C.textSub }}>
            Host: {(dest.config?.host as string) ?? '—'} · Port: {(dest.config?.port as number) ?? '—'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {dest.dest_type !== 'placeholder' && (
            dest.status === 'active' ? (
              <button onClick={handleStop} disabled={busy} style={{ background: C.textSub, border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Stop
              </button>
            ) : (
              <button onClick={handleStart} disabled={busy} style={{ background: C.violet, border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Start
              </button>
            )
          )}
          {onNavigate && (
            <button
              onClick={() => { onClose(); onNavigate('destinations') }}
              style={{ background: 'transparent', border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 14px', color: C.textSub, cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}
            >
              Full settings →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
