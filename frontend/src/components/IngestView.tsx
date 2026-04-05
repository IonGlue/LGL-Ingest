import { useState, useEffect, useCallback } from 'react'
import { Radio, Signal, Tv, Copy, Eye, EyeOff, Plus, Trash2, RefreshCw } from 'lucide-react'
import { api, type Source } from '../api.js'

const C = {
  base: '#FAFAFA', panel: '#FFFFFF', raised: '#E5E5EA',
  textPrimary: '#1A1A2E', textSub: '#555566', textMuted: '#8E8E9F',
  violet: '#8B5CF6', live: '#10B981', warning: '#F59E0B', error: '#EF4444',
}

const STATUS_COLOR: Record<string, string> = {
  active: C.live, waiting: C.warning, error: C.error, idle: C.textMuted,
}

const TYPE_ICON: Record<string, typeof Radio> = {
  rtmp_listen: Tv, srt_listen: Signal, encoder: Radio,
}

const INGEST_TYPES = [
  { value: 'rtmp_listen', label: 'RTMP' },
  { value: 'srt_listen', label: 'SRT' },
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

function maskStreamKey(key: string): string {
  if (key.length < 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

function buildIngestUrl(src: Source): string {
  const cfg = src.config
  const host = window.location.hostname || 'localhost'
  if (src.source_type === 'rtmp_listen') {
    const port = cfg.port ?? 1935
    const key = cfg.stream_key ?? ''
    return `rtmp://${host}:${port}/live/${key}`
  }
  if (src.source_type === 'srt_listen') {
    const port = cfg.port ?? src.internal_port
    if (port == null) return 'srt://— port pending (start source first)'
    return `srt://${host}:${port}`
  }
  return ''
}

interface CreateFormProps {
  onCreated: (src: Source) => void
  onCancel: () => void
}

function CreateForm({ onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState('rtmp_listen')
  const [port, setPort] = useState('')
  const [latency, setLatency] = useState('200')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const config: Record<string, unknown> = {}
      if (port) config.port = Number(port)
      if (type === 'srt_listen') config.latency_ms = Number(latency)
      const src = await api.createSource({ name, source_type: type, config })
      onCreated(src)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ ...s.card, border: `2px solid ${C.violet}44` }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, fontFamily: 'Syne, sans-serif' }}>New Ingest Source</div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && <div style={{ color: C.error, fontSize: 12 }}>{error}</div>}
        <div>
          <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Name</label>
          <input
            value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Main Camera"
            style={{ width: '100%', background: C.base, border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Type</label>
          <select
            value={type} onChange={e => setType(e.target.value)}
            style={{ width: '100%', background: C.base, border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary }}
          >
            {INGEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Port (optional, auto-assigned if empty)</label>
          <input
            value={port} onChange={e => setPort(e.target.value)} placeholder="e.g. 1935"
            style={{ width: '100%', background: C.base, border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, boxSizing: 'border-box' }}
          />
        </div>
        {type === 'srt_listen' && (
          <div>
            <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Latency (ms)</label>
            <input
              value={latency} onChange={e => setLatency(e.target.value)}
              style={{ width: '100%', background: C.base, border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, boxSizing: 'border-box' }}
            />
          </div>
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

function SourceCard({ src, onDelete, onUpdate }: { src: Source; onDelete: (id: string) => void; onUpdate: () => void }) {
  const [showKey, setShowKey] = useState(false)
  const Icon = TYPE_ICON[src.source_type] ?? Radio
  const statusColor = STATUS_COLOR[src.status] ?? C.textMuted
  const streamKey = (src.config.stream_key as string) ?? ''
  const ingestUrl = buildIngestUrl(src)
  const isRtmp = src.source_type === 'rtmp_listen'

  async function regenerateKey(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await api.updateSource(src.id, { config: { ...src.config, regenerate_key: true } })
      onUpdate()
    } catch (err) {
      console.error(err)
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${src.name}"?`)) return
    try {
      await api.deleteSource(src.id)
      onDelete(src.id)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon size={16} color={C.textSub} />
        <span style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary, flex: 1 }}>{src.name}</span>
        <span style={{
          ...s.badge,
          background: isRtmp ? '#EF444422' : '#8B5CF622',
          color: isRtmp ? '#DC2626' : C.violet,
        }}>
          {isRtmp ? 'RTMP' : 'SRT'}
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: statusColor,
          boxShadow: src.status === 'active' ? `0 0 6px ${statusColor}` : undefined,
        }} />
      </div>

      {ingestUrl && (
        <div style={s.urlBox}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ingestUrl}</span>
          <CopyBtn text={ingestUrl} />
        </div>
      )}

      {isRtmp && streamKey && (
        <div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Stream Key</div>
          <div style={{ ...s.urlBox, fontSize: 11 }}>
            <span style={{ flex: 1, fontFamily: 'Courier New, monospace' }}>
              {showKey ? streamKey : maskStreamKey(streamKey)}
            </span>
            <button style={s.iconBtn} onClick={e => { e.stopPropagation(); setShowKey(!showKey) }}>
              {showKey ? <EyeOff size={13} color={C.textMuted} /> : <Eye size={13} color={C.textMuted} />}
            </button>
            <CopyBtn text={streamKey} />
            <button style={s.iconBtn} title="Regenerate key" onClick={regenerateKey}>
              <RefreshCw size={13} color={C.textMuted} />
            </button>
          </div>
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

export default function IngestView() {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const ingestTypes = ['rtmp_listen', 'srt_listen']

  const load = useCallback(async () => {
    try {
      const all = await api.getSources()
      setSources(all.filter(s => ingestTypes.includes(s.source_type)))
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
          <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, fontFamily: 'Syne, sans-serif' }}>Ingest Sources</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
            Configure ingest endpoints. Copy the URL into your encoder or streaming software.
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
          <Plus size={15} /> Add Source
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        {showCreate && (
          <CreateForm
            onCreated={src => { setSources(s => [...s, src]); setShowCreate(false) }}
            onCancel={() => setShowCreate(false)}
          />
        )}
        {sources.length === 0 && !showCreate && (
          <div style={{ color: C.textMuted, fontSize: 14, padding: 40, textAlign: 'center' }}>
            No ingest sources configured. Click "Add Source" to create one.
          </div>
        )}
        {sources.map(src => (
          <SourceCard
            key={src.id}
            src={src}
            onDelete={id => setSources(s => s.filter(x => x.id !== id))}
            onUpdate={load}
          />
        ))}
      </div>
    </div>
  )
}
