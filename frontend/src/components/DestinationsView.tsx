import { useState, useEffect, useCallback } from 'react'
import { Tv, Rss, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { api, type Destination } from '../api.js'

const C = {
  base: '#FAFAFA', panel: '#FFFFFF', raised: '#E5E5EA',
  textPrimary: '#1A1A2E', textSub: '#555566', textMuted: '#8E8E9F',
  violet: '#8B5CF6', live: '#10B981', warning: '#F59E0B', error: '#EF4444',
}

const STATUS_COLOR: Record<string, string> = {
  active: C.live, waiting: C.warning, error: C.error, idle: C.textMuted,
}

const PLATFORM_META: Record<string, { label: string; color: string; icon: string }> = {
  youtube: { label: 'YouTube', color: '#ff0000', icon: '▶' },
  twitch: { label: 'Twitch', color: '#9147ff', icon: '◈' },
  facebook: { label: 'Facebook', color: '#1877f2', icon: 'f' },
  custom: { label: 'RTMP', color: '#8E8E9F', icon: '⟶' },
}

function detectPlatform(dest: Destination): string {
  const url = (dest.config?.url as string) ?? ''
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('twitch.tv')) return 'twitch'
  if (url.includes('facebook.com') || url.includes('fbcdn.net')) return 'facebook'
  return 'custom'
}

const DEST_TYPES = [
  { value: 'rtmp', label: 'RTMP Push' },
  { value: 'srt_push', label: 'SRT Push' },
]

const s = {
  card: {
    background: C.panel, borderRadius: 8, border: `1px solid ${C.raised}`,
    padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 10,
    cursor: 'pointer', transition: 'box-shadow 0.15s',
  },
  badge: {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    textTransform: 'uppercase' as const, letterSpacing: 0.8,
  },
  urlBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#F5F5F8', borderRadius: 6, padding: '8px 12px',
    fontFamily: 'Courier New, Consolas, monospace', fontSize: 12, color: C.textPrimary,
    border: `1px solid ${C.raised}`,
  },
  iconBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
    display: 'flex', alignItems: 'center',
  },
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      style={s.iconBtn}
      title="Copy"
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      <Copy size={14} color={copied ? C.live : C.textMuted} />
    </button>
  )
}

function maskUrl(url: string): string {
  const parts = url.split('/')
  const key = parts[parts.length - 1]
  if (!key || key.length < 8) return url
  return parts.slice(0, -1).join('/') + '/' + key.slice(0, 4) + '••••••••' + key.slice(-4)
}

interface CreateFormProps {
  onCreated: (dest: Destination) => void
  onCancel: () => void
}

function CreateForm({ onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState('rtmp')
  const [url, setUrl] = useState('rtmp://')
  const [streamKey, setStreamKey] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('9999')
  const [latency, setLatency] = useState('200')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const config: Record<string, unknown> = {}
      if (type === 'rtmp') {
        const fullUrl = streamKey ? `${url.replace(/\/$/, '')}/${streamKey}` : url
        config.url = fullUrl
        config._stream_key = streamKey
      } else {
        config.host = host
        config.port = Number(port)
        config.latency_ms = Number(latency)
      }
      const dest = await api.createDest({ name, dest_type: type, config })
      onCreated(dest)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = { width: '100%', background: C.base, border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, boxSizing: 'border-box' as const }

  return (
    <div style={{ ...s.card, border: `2px solid ${C.violet}44` }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, fontFamily: 'Syne, sans-serif' }}>New Destination</div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && <div style={{ color: C.error, fontSize: 12 }}>{error}</div>}
        <div>
          <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. YouTube Main Channel" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
            {DEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {type === 'rtmp' && (
          <>
            <div>
              <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>RTMP URL</label>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="rtmp://a.rtmp.youtube.com/live2" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Stream Key</label>
              <input value={streamKey} onChange={e => setStreamKey(e.target.value)} placeholder="Paste your stream key" type="password" style={inputStyle} />
            </div>
          </>
        )}
        {type === 'srt_push' && (
          <>
            <div>
              <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Host</label>
              <input value={host} onChange={e => setHost(e.target.value)} placeholder="e.g. srt.example.com" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Port</label>
                <input value={port} onChange={e => setPort(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Latency (ms)</label>
                <input value={latency} onChange={e => setLatency(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={busy} style={{ background: C.violet, border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            {busy ? 'Creating...' : 'Create'}
          </button>
          <button type="button" onClick={onCancel} style={{ background: 'transparent', border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 18px', color: C.textSub, cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function DestCard({ dest, onDelete }: { dest: Destination; onDelete: (id: string) => void }) {
  const [showUrl, setShowUrl] = useState(false)
  const statusColor = STATUS_COLOR[dest.status] ?? C.textMuted
  const isRtmp = dest.dest_type === 'rtmp'
  const platform = isRtmp ? detectPlatform(dest) : null
  const meta = platform ? PLATFORM_META[platform] : null
  const url = (dest.config?.url as string) ?? ''
  const Icon = isRtmp ? Tv : Rss

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${dest.name}"?`)) return
    try {
      await api.deleteDest(dest.id)
      onDelete(dest.id)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon size={16} color={C.textSub} />
        <span style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary, flex: 1 }}>{dest.name}</span>
        {meta && (
          <span style={{ ...s.badge, background: `${meta.color}18`, color: meta.color }}>
            {meta.icon} {meta.label}
          </span>
        )}
        {!isRtmp && (
          <span style={{ ...s.badge, background: '#8B5CF622', color: C.violet }}>SRT</span>
        )}
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: statusColor,
          boxShadow: dest.status === 'active' ? `0 0 6px ${statusColor}` : undefined,
        }} />
      </div>

      {isRtmp && url && (
        <div style={s.urlBox}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showUrl ? url : maskUrl(url)}
          </span>
          <button style={s.iconBtn} onClick={e => { e.stopPropagation(); setShowUrl(!showUrl) }}>
            {showUrl ? <EyeOff size={13} color={C.textMuted} /> : <Eye size={13} color={C.textMuted} />}
          </button>
          <CopyBtn text={url} />
        </div>
      )}

      {!isRtmp && (
        <div style={s.urlBox}>
          <span style={{ flex: 1 }}>
            srt://{(dest.config?.host as string) ?? ''}:{(dest.config?.port as number) ?? ''}
          </span>
          <CopyBtn text={`srt://${dest.config?.host ?? ''}:${dest.config?.port ?? ''}`} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={handleDelete} style={{ ...s.iconBtn, color: `${C.error}88` }} title="Delete">
          <Trash2 size={15} color={`${C.error}88`} />
        </button>
      </div>
    </div>
  )
}

export default function DestinationsView() {
  const [dests, setDests] = useState<Destination[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const destTypes = ['rtmp', 'srt_push']

  const load = useCallback(async () => {
    try {
      const all = await api.getDests()
      setDests(all.filter(d => destTypes.includes(d.dest_type)))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [load])

  if (loading) return <div style={{ padding: 24, color: C.textSub }}>Loading...</div>

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, background: C.base }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, fontFamily: 'Syne, sans-serif' }}>Destinations</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
            Configure streaming destinations. Add them to the Rack to start routing.
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            background: C.violet, border: 'none', borderRadius: 6,
            padding: '8px 16px', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
        >
          <Plus size={15} /> Add Destination
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        {showCreate && (
          <CreateForm
            onCreated={dest => { setDests(d => [...d, dest]); setShowCreate(false) }}
            onCancel={() => setShowCreate(false)}
          />
        )}
        {dests.length === 0 && !showCreate && (
          <div style={{ color: C.textMuted, fontSize: 14, padding: 40, textAlign: 'center' }}>
            No destinations configured. Click "Add Destination" to create one.
          </div>
        )}
        {dests.map(dest => (
          <DestCard
            key={dest.id}
            dest={dest}
            onDelete={id => setDests(d => d.filter(x => x.id !== id))}
          />
        ))}
      </div>
    </div>
  )
}
