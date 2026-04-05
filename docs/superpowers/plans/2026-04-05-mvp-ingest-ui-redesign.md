# MVP Ingest UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the frontend to three tabs (Rack / Ingest / Destinations), add RTMP ingest source type, remove the Redistribute view.

**Architecture:** Frontend gets two new views (IngestView, DestinationsView) alongside the existing RackPatchbay. Backend adds `rtmp_listen` as a valid source type with auto-generated stream keys. A new Rust source worker handles incoming RTMP connections using the `rml_rtmp` crate and re-exposes them as SRT on the internal port.

**Tech Stack:** React 18 (inline styles, lucide-react icons), Hono (TypeScript server), Rust + GStreamer + rml_rtmp (source worker)

---

## File Map

### Files to Delete
- `frontend/src/components/Redistribute.tsx` — Redistribute view (replaced by Destinations tab)
- `frontend/src/components/AddRedistributePanel.tsx` — Redistribute add panel

### Files to Create
- `frontend/src/components/IngestView.tsx` — Ingest tab: list/card view of ingest sources with copyable URLs
- `frontend/src/components/DestinationsView.tsx` — Destinations tab: list/card view of destination presets
- `frontend/src/components/EditSourceModal.tsx` — Modal for editing source settings (used in Rack click-to-edit and Ingest tab)
- `frontend/src/components/EditDestModal.tsx` — Modal for editing destination settings (used in Rack click-to-edit and Destinations tab)
- `ingest-source/src/sources/rtmp_listen.rs` — New RTMP listen source worker

### Files to Modify
- `frontend/src/App.tsx` — Three-tab navigation, remove Redistribute import
- `frontend/src/api.ts` — Add `getIngestUrl` API method
- `frontend/src/components/RackPatchbay.tsx` — Add click-to-edit on slots, import modals
- `frontend/src/components/AddSourcePanel.tsx` — Add `rtmp_listen` to source types
- `server/src/api/sources.ts` — Add `rtmp_listen` type, stream key generation, ingest-url endpoint
- `ingest-source/src/main.rs` — Add `RtmpListenConfig` struct and `rtmp_listen` dispatch
- `ingest-source/src/sources/mod.rs` — Register `rtmp_listen` module
- `ingest-source/Cargo.toml` — Add `rml_rtmp` and `bytes` dependencies

---

## Task 1: Remove Redistribute View & Update Navigation

**Files:**
- Delete: `frontend/src/components/Redistribute.tsx`
- Delete: `frontend/src/components/AddRedistributePanel.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Delete Redistribute files**

```bash
rm frontend/src/components/Redistribute.tsx
rm frontend/src/components/AddRedistributePanel.tsx
```

- [ ] **Step 2: Update App.tsx to three-tab navigation**

Replace the entire content of `frontend/src/App.tsx` with:

```tsx
import { useState, useEffect } from 'react'
import { api } from './api.js'
import Login from './components/Login.js'
import RackPatchbay from './components/RackPatchbay.js'
import IngestView from './components/IngestView.js'
import DestinationsView from './components/DestinationsView.js'

type View = 'rack' | 'ingest' | 'destinations'

const NAV_STYLE: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 0,
  padding: '0 20px', height: 44,
  background: 'rgba(255,255,255,0.85)', borderBottom: '1px solid #E5E5EA',
  backdropFilter: 'blur(16px)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
}

function NavBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #8B5CF6' : '2px solid transparent',
        color: active ? '#1A1A2E' : '#8E8E9F',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        padding: '0 14px',
        height: '100%',
        cursor: 'pointer',
        transition: 'color 0.15s',
      }}
    >
      {label}
    </button>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [localLogin, setLocalLogin] = useState(false)
  const [view, setView] = useState<View>('rack')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem('token', urlToken)
      window.history.replaceState({}, '', window.location.pathname)
    }

    async function init() {
      if (localStorage.getItem('token')) {
        try {
          await api.me()
          setAuthed(true)
          return
        } catch {
          localStorage.removeItem('token')
        }
      }

      const config = await api.getConfig().catch(() => ({ local_login: true, portal_url: undefined }))
      if (!config.local_login && config.portal_url) {
        window.location.href = `${config.portal_url}?return_to=${encodeURIComponent(window.location.href)}`
        return
      }
      setLocalLogin(true)
    }

    init().finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: '2rem', color: '#8E8E9F' }}>Loading...</div>
  if (!authed && localLogin) return <Login onLogin={() => setAuthed(true)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#FAFAFA' }}>
      <div style={NAV_STYLE}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1A1A2E', marginRight: 16, fontFamily: 'Syne, sans-serif' }}>LGL Ingest</span>
        <NavBtn label="Rack" active={view === 'rack'} onClick={() => setView('rack')} />
        <NavBtn label="Ingest" active={view === 'ingest'} onClick={() => setView('ingest')} />
        <NavBtn label="Destinations" active={view === 'destinations'} onClick={() => setView('destinations')} />
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'rack' && <RackPatchbay />}
        {view === 'ingest' && <IngestView />}
        {view === 'destinations' && <DestinationsView />}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create placeholder IngestView and DestinationsView so the app compiles**

Create `frontend/src/components/IngestView.tsx`:

```tsx
export default function IngestView() {
  return <div style={{ padding: 24, color: '#555566' }}>Ingest view — coming soon</div>
}
```

Create `frontend/src/components/DestinationsView.tsx`:

```tsx
export default function DestinationsView() {
  return <div style={{ padding: 24, color: '#555566' }}>Destinations view — coming soon</div>
}
```

- [ ] **Step 4: Verify frontend compiles**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: replace Redistribute with three-tab navigation (Rack/Ingest/Destinations)"
```

---

## Task 2: Backend — Add `rtmp_listen` Source Type & Stream Key Generation

**Files:**
- Modify: `server/src/api/sources.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add `rtmp_listen` to VALID_SOURCE_TYPES and add stream key auto-generation**

In `server/src/api/sources.ts`, replace line 7:

```typescript
const VALID_SOURCE_TYPES = ['encoder', 'srt_listen', 'srt_pull', 'rtmp_pull', 'rtmp_listen', 'test_pattern', 'placeholder']
```

Then in the `POST /` handler, after `const config = body.config ?? {}` (line 35), add stream key auto-generation:

```typescript
  const config: Record<string, unknown> = body.config ?? {}

  // Auto-generate stream key for RTMP listen sources
  if (body.source_type === 'rtmp_listen' && !config.stream_key) {
    config.stream_key = crypto.randomUUID()
    config.auto_generated_key = true
  }
```

Add `import crypto from 'node:crypto'` at the top if not present (actually `crypto.randomUUID()` is a global in Node 19+, but to be safe use the import). Actually, `crypto.randomUUID()` is available globally in Node 18+. Use it directly.

Replace the config line in the POST handler. The full change to the POST handler body (lines 26-73):

```typescript
app.post('/', async (c) => {
  requireOperatorOrAbove(c.var.user)
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string') throw AppError.validation('name is required')
  if (!VALID_SOURCE_TYPES.includes(body.source_type)) {
    throw AppError.validation(`source_type must be one of: ${VALID_SOURCE_TYPES.join(', ')}`)
  }

  const { db } = c.var.state
  const config: Record<string, unknown> = body.config ?? {}

  // Auto-generate stream key for RTMP listen sources
  if (body.source_type === 'rtmp_listen' && !config.stream_key) {
    config.stream_key = crypto.randomUUID()
    config.auto_generated_key = true
  }

  let [source] = await db`
    INSERT INTO sources (name, source_type, device_id, config, position_x, position_y)
    VALUES (
      ${body.name},
      ${body.source_type},
      ${body.device_id ?? null},
      ${JSON.stringify(config)},
      ${body.position_x ?? 100},
      ${body.position_y ?? 100}
    )
    RETURNING *
  `

  // Register with supervisor (skip for placeholder — no process needed)
  if (body.source_type !== 'placeholder') {
    try {
      const supervisorSource = await client(c).createSource({
        id: source.id,
        name: source.name,
        source_type: source.source_type,
        config,
      }) as { internal_port?: number }
      if (supervisorSource?.internal_port != null) {
        await c.var.state.db`
          UPDATE sources SET internal_port = ${supervisorSource.internal_port} WHERE id = ${source.id}
        `
        source = { ...source, internal_port: supervisorSource.internal_port }
      }
    } catch (e) {
      console.error('failed to register source with supervisor:', e)
    }
  }

  return c.json(source, 201)
})
```

- [ ] **Step 2: Add ingest-url endpoint**

Add this route after the existing `POST /:id/stop` handler, before `export default app`:

```typescript
app.get('/:id/ingest-url', async (c) => {
  const [source] = await c.var.state.db`SELECT * FROM sources WHERE id = ${c.req.param('id')}`
  if (!source) throw AppError.notFound()

  const host = c.req.header('host') ?? 'localhost'
  const baseHost = host.split(':')[0]
  const config = source.config as Record<string, unknown>

  let ingest_url = ''
  switch (source.source_type) {
    case 'rtmp_listen': {
      const port = config.port ?? 1935
      const key = config.stream_key ?? ''
      ingest_url = `rtmp://${baseHost}:${port}/live/${key}`
      break
    }
    case 'srt_listen': {
      const port = config.port ?? source.internal_port
      ingest_url = `srt://${baseHost}:${port}`
      break
    }
    default:
      ingest_url = ''
  }

  return c.json({ ingest_url, source_type: source.source_type, config })
})
```

- [ ] **Step 3: Add stream key regeneration in PATCH handler**

In the PATCH handler, after the existing config update (line 92), add:

```typescript
  if (body.config != null) {
    const newConfig = body.config as Record<string, unknown>
    // Regenerate stream key if requested
    if (newConfig.regenerate_key) {
      newConfig.stream_key = crypto.randomUUID()
      newConfig.auto_generated_key = true
      delete newConfig.regenerate_key
    }
    await db`UPDATE sources SET config = ${JSON.stringify(newConfig)} WHERE id = ${id}`
  }
```

This replaces the existing `if (body.config != null)` line.

- [ ] **Step 4: Add getIngestUrl to frontend API**

In `frontend/src/api.ts`, add after the `stopSource` line (line 38):

```typescript
  getIngestUrl: (id: string) => request<{ ingest_url: string; source_type: string; config: Record<string, unknown> }>('GET', `/sources/${id}/ingest-url`),
```

- [ ] **Step 5: Verify server compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): add rtmp_listen source type with auto-generated stream keys and ingest-url endpoint"
```

---

## Task 3: Frontend — IngestView Component

**Files:**
- Modify: `frontend/src/components/IngestView.tsx` (replace placeholder)

- [ ] **Step 1: Implement IngestView**

Replace `frontend/src/components/IngestView.tsx` with:

```tsx
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
  if (src.source_type === 'rtmp_listen') {
    const port = cfg.port ?? 1935
    const key = cfg.stream_key ?? ''
    return `rtmp://<host>:${port}/live/${key}`
  }
  if (src.source_type === 'srt_listen') {
    const port = cfg.port ?? src.internal_port
    return `srt://<host>:${port}`
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
      {/* Header row */}
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

      {/* Ingest URL */}
      {ingestUrl && (
        <div style={s.urlBox}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ingestUrl}</span>
          <CopyBtn text={ingestUrl} />
        </div>
      )}

      {/* Stream key (RTMP only) */}
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

      {/* Actions */}
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
      {/* Header */}
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

      {/* Cards */}
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
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): implement IngestView with source cards, copyable URLs, stream key management"
```

---

## Task 4: Frontend — DestinationsView Component

**Files:**
- Modify: `frontend/src/components/DestinationsView.tsx` (replace placeholder)

- [ ] **Step 1: Implement DestinationsView**

Replace `frontend/src/components/DestinationsView.tsx` with:

```tsx
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
        // Combine base URL and stream key
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
      {/* Header */}
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

      {/* URL */}
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

      {/* Actions */}
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
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): implement DestinationsView with platform detection, masked URLs, RTMP/SRT creation"
```

---

## Task 5: Frontend — Add `rtmp_listen` to Rack's AddSourcePanel

**Files:**
- Modify: `frontend/src/components/AddSourcePanel.tsx`
- Modify: `frontend/src/components/RackPatchbay.tsx`

- [ ] **Step 1: Add rtmp_listen type to AddSourcePanel**

In `frontend/src/components/AddSourcePanel.tsx`, add `rtmp_listen` to the SOURCE_TYPES array (after line 4):

```typescript
const SOURCE_TYPES = [
  { value: 'rtmp_listen', label: 'RTMP Listen (inbound)', fields: ['port'] },
  { value: 'encoder', label: 'Encoder (SRTLA)', fields: [] },
  { value: 'srt_listen', label: 'SRT Listen (inbound)', fields: ['port', 'latency_ms'] },
  { value: 'srt_pull', label: 'SRT Pull (outbound)', fields: ['host', 'port', 'latency_ms'] },
  { value: 'rtmp_pull', label: 'RTMP Pull', fields: ['url'] },
  { value: 'test_pattern', label: 'Test Pattern', fields: ['pattern', 'width', 'height', 'framerate', 'bitrate_kbps'] },
  { value: 'placeholder', label: 'Placeholder', fields: [] },
]
```

Add RTMP listen defaults:

```typescript
const DEFAULTS: Record<string, Record<string, string>> = {
  rtmp_listen: { port: '1935' },
  srt_listen: { port: '5100', latency_ms: '200' },
  srt_pull: { host: '', port: '9999', latency_ms: '200' },
  rtmp_pull: { url: '' },
  test_pattern: { pattern: 'smpte', width: '1920', height: '1080', framerate: '30', bitrate_kbps: '4000' },
}
```

- [ ] **Step 2: Add rtmp_listen icon to RackPatchbay**

In `frontend/src/components/RackPatchbay.tsx`, add to the SRC_ICONS map (around line 52):

```typescript
const SRC_ICONS: Record<string, LucideIcon> = {
  encoder:      Radio,
  srt_listen:   Signal,
  srt_pull:     Link,
  rtmp_pull:    Tv,
  rtmp_listen:  Tv,
  test_pattern: Sliders,
  placeholder:  CircleDashed,
}
```

- [ ] **Step 3: Verify frontend compiles**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(frontend): add rtmp_listen source type to Rack's AddSourcePanel and icon map"
```

---

## Task 6: Frontend — Edit Modals for Rack Click-to-Edit

**Files:**
- Create: `frontend/src/components/EditSourceModal.tsx`
- Create: `frontend/src/components/EditDestModal.tsx`
- Modify: `frontend/src/components/RackPatchbay.tsx`

- [ ] **Step 1: Create EditSourceModal**

Create `frontend/src/components/EditSourceModal.tsx`:

```tsx
import { useState } from 'react'
import { X, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { api, type Source } from '../api.js'

const C = {
  panel: '#FFFFFF', raised: '#E5E5EA', textPrimary: '#1A1A2E',
  textSub: '#555566', textMuted: '#8E8E9F', violet: '#8B5CF6',
  live: '#10B981', error: '#EF4444',
}

const STATUS_COLOR: Record<string, string> = {
  active: C.live, waiting: '#F59E0B', error: C.error, idle: C.textMuted,
}

function maskStreamKey(key: string): string {
  if (key.length < 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

interface Props {
  source: Source
  onClose: () => void
  onUpdated: () => void
  onNavigate?: (view: string) => void
}

export default function EditSourceModal({ source, onClose, onUpdated, onNavigate }: Props) {
  const [name, setName] = useState(source.name)
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const statusColor = STATUS_COLOR[source.status] ?? C.textMuted
  const isRtmp = source.source_type === 'rtmp_listen'
  const isSrt = source.source_type === 'srt_listen'
  const streamKey = (source.config.stream_key as string) ?? ''
  const port = (source.config.port as number) ?? source.internal_port ?? ''

  let ingestUrl = ''
  if (isRtmp) ingestUrl = `rtmp://<host>:${port}/live/${streamKey}`
  else if (isSrt) ingestUrl = `srt://<host>:${port}`

  async function saveName() {
    if (name === source.name) return
    setBusy(true)
    try {
      await api.updateSource(source.id, { name })
      onUpdated()
    } catch (e) { console.error(e) }
    finally { setBusy(false) }
  }

  async function handleStart() {
    try { await api.startSource(source.id); onUpdated() } catch (e) { console.error(e) }
  }

  async function handleStop() {
    try { await api.stopSource(source.id); onUpdated() } catch (e) { console.error(e) }
  }

  async function regenerateKey() {
    try {
      await api.updateSource(source.id, { config: { ...source.config, regenerate_key: true } })
      onUpdated()
    } catch (e) { console.error(e) }
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
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, fontFamily: 'Syne, sans-serif', flex: 1 }}>
            Edit Source
          </span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, marginRight: 8 }} />
          <span style={{ fontSize: 11, color: statusColor, textTransform: 'capitalize', marginRight: 12 }}>{source.status}</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
            <X size={18} color={C.textMuted} />
          </button>
        </div>

        {/* Name */}
        <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Name</label>
        <input
          value={name} onChange={e => setName(e.target.value)} onBlur={saveName}
          style={{ width: '100%', background: '#FAFAFA', border: `1px solid ${C.raised}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, marginBottom: 14, boxSizing: 'border-box' }}
        />

        {/* Type */}
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>
          Type: <span style={{ color: C.textPrimary, fontWeight: 500 }}>{source.source_type.replace(/_/g, ' ')}</span>
        </div>

        {/* Ingest URL */}
        {ingestUrl && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Ingest URL</label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#F5F5F8', borderRadius: 6, padding: '8px 12px',
              fontFamily: 'Courier New, monospace', fontSize: 11, color: C.textPrimary,
              border: `1px solid ${C.raised}`,
            }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ingestUrl}</span>
              <button onClick={() => copyText(ingestUrl)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                <Copy size={13} color={copied ? C.live : C.textMuted} />
              </button>
            </div>
          </div>
        )}

        {/* Stream key */}
        {isRtmp && streamKey && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: C.textSub, display: 'block', marginBottom: 4 }}>Stream Key</label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#F5F5F8', borderRadius: 6, padding: '8px 12px',
              fontFamily: 'Courier New, monospace', fontSize: 11,
              border: `1px solid ${C.raised}`,
            }}>
              <span style={{ flex: 1 }}>{showKey ? streamKey : maskStreamKey(streamKey)}</span>
              <button onClick={() => setShowKey(!showKey)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                {showKey ? <EyeOff size={13} color={C.textMuted} /> : <Eye size={13} color={C.textMuted} />}
              </button>
              <button onClick={() => copyText(streamKey)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                <Copy size={13} color={C.textMuted} />
              </button>
              <button onClick={regenerateKey} title="Regenerate" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                <RefreshCw size={13} color={C.textMuted} />
              </button>
            </div>
          </div>
        )}

        {/* Start / Stop */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {source.source_type !== 'placeholder' && (
            source.status === 'active' ? (
              <button onClick={handleStop} disabled={busy} style={{ background: C.textSub, border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Stop
              </button>
            ) : (
              <button onClick={handleStart} disabled={busy} style={{ background: C.violet, border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Start
              </button>
            )
          )}
          {onNavigate && (isRtmp || isSrt) && (
            <button
              onClick={() => { onClose(); onNavigate('ingest') }}
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
```

- [ ] **Step 2: Create EditDestModal**

Create `frontend/src/components/EditDestModal.tsx`:

```tsx
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
```

- [ ] **Step 3: Wire up click-to-edit in RackPatchbay**

In `frontend/src/components/RackPatchbay.tsx`, add imports at the top (after existing imports):

```typescript
import EditSourceModal from './EditSourceModal.js'
import EditDestModal from './EditDestModal.js'
```

Inside the `RackPatchbay` component, after the existing state declarations (around line 441), add:

```typescript
  const [editSource, setEditSource] = useState<Source | null>(null)
  const [editDest, setEditDest] = useState<Destination | null>(null)
```

Modify `handleSourceClick` to open the edit modal on a second click (replace lines 527-530):

```typescript
  const handleSourceClick = useCallback((src: Source) => {
    if (src.source_type === 'placeholder') return
    if (selectedSourceId === src.id) {
      // Second click on same source → open edit modal
      setSelectedSourceId(null)
      setEditSource(src)
    } else {
      setSelectedSourceId(src.id)
    }
  }, [selectedSourceId])
```

Add a handler for dest double-purpose click. Modify `handleDestClick` (replace lines 532-542):

```typescript
  const handleDestClick = useCallback(async (dest: Destination) => {
    if (dest.dest_type === 'placeholder') return
    if (selectedSourceId) {
      // Routing mode: create route
      try {
        const route = await api.createRoute(selectedSourceId, dest.id)
        setRoutes(rs => [...rs, route])
      } catch (e) {
        console.error('failed to create route:', e)
      } finally {
        setSelectedSourceId(null)
      }
    } else {
      // No source selected: open edit modal
      setEditDest(dest)
    }
  }, [selectedSourceId])
```

At the bottom of the component's return JSX, after the `{showAddDest && ...}` block (before the closing `</div>`), add:

```tsx
      {editSource && (
        <EditSourceModal
          source={editSource}
          onClose={() => setEditSource(null)}
          onUpdated={() => { load(); setEditSource(null) }}
        />
      )}
      {editDest && (
        <EditDestModal
          dest={editDest}
          onClose={() => setEditDest(null)}
          onUpdated={() => { load(); setEditDest(null) }}
        />
      )}
```

- [ ] **Step 4: Verify frontend compiles**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(frontend): add EditSourceModal and EditDestModal with click-to-edit in Rack"
```

---

## Task 7: Rust — RTMP Listen Source Worker

**Files:**
- Create: `ingest-source/src/sources/rtmp_listen.rs`
- Modify: `ingest-source/src/sources/mod.rs`
- Modify: `ingest-source/src/main.rs`
- Modify: `ingest-source/Cargo.toml`

- [ ] **Step 1: Add rml_rtmp and bytes dependencies to Cargo.toml**

In `ingest-source/Cargo.toml`, add to `[dependencies]`:

```toml
rml_rtmp = "0.8"
bytes = "1"
```

- [ ] **Step 2: Create rtmp_listen.rs source worker**

Create `ingest-source/src/sources/rtmp_listen.rs`:

```rust
//! RTMP listen source: accepts an incoming RTMP push and re-exposes
//! the video as SRT on the internal port.
//!
//! Uses rml_rtmp for RTMP handshake and protocol handling.
//! Receives H.264 video data and feeds it into a GStreamer pipeline
//! via appsrc → flvdemux → h264parse → mpegtsmux → srtsink.

use anyhow::{Context, Result};
use bytes::Bytes;
use gstreamer::prelude::*;
use log::{info, warn};
use rml_rtmp::handshake::{Handshake, HandshakeProcessResult, PeerType};
use rml_rtmp::sessions::{
    ServerSession, ServerSessionConfig, ServerSessionEvent, ServerSessionResult,
};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::RtmpListenConfig;

pub async fn run(id: String, internal_port: u16, config: RtmpListenConfig) -> Result<()> {
    let listen_port = config.port;
    let expected_key = config.stream_key.clone();

    info!("[{id}] rtmp_listen source: listening on :{listen_port} → re-exposing on SRT :{internal_port}");

    // Build GStreamer pipeline with appsrc for feeding RTMP FLV data
    let output_uri = format!(
        "srt://0.0.0.0:{internal_port}?mode=listener&latency={}",
        config.latency_ms
    );

    gstreamer::init().context("failed to init GStreamer")?;

    let pipeline_str = format!(
        "appsrc name=src is-live=true format=3 ! \
         flvdemux name=demux ! \
         queue ! \
         h264parse ! \
         mpegtsmux ! \
         srtsink name=srt_out uri=\"{output_uri}\" wait-for-connection=false"
    );

    info!("[{id}] pipeline: {pipeline_str}");

    let pipeline = gstreamer::parse::launch(&pipeline_str)
        .context("failed to parse pipeline")?
        .downcast::<gstreamer::Pipeline>()
        .map_err(|_| anyhow::anyhow!("not a pipeline"))?;

    let appsrc = pipeline
        .by_name("src")
        .context("no appsrc element")?
        .downcast::<gstreamer_app::AppSrc>()
        .map_err(|_| anyhow::anyhow!("not an appsrc"))?;

    let bus = pipeline.bus().context("no bus")?;
    pipeline
        .set_state(gstreamer::State::Playing)
        .context("set Playing failed")?;
    info!("[{id}] rtmp_listen pipeline playing, waiting for RTMP connection");

    let appsrc = Arc::new(Mutex::new(appsrc));

    // Accept connections in a loop (one at a time for MVP)
    let listener = TcpListener::bind(format!("0.0.0.0:{listen_port}"))
        .await
        .context(format!("failed to bind RTMP port {listen_port}"))?;

    info!("[{id}] RTMP server listening on :{listen_port}");

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (mut stream, addr) = accept_result.context("accept failed")?;
                info!("[{id}] RTMP connection from {addr}");

                // RTMP handshake
                let mut handshake = Handshake::new(PeerType::Server);
                let mut buf = [0u8; 4096];

                // Process handshake
                let mut handshake_complete = false;
                while !handshake_complete {
                    let n = stream.read(&mut buf).await.context("read during handshake")?;
                    if n == 0 { anyhow::bail!("connection closed during handshake"); }

                    match handshake.process_bytes(&buf[..n])
                        .map_err(|e| anyhow::anyhow!("handshake error: {:?}", e))?
                    {
                        HandshakeProcessResult::InProgress { response_bytes } => {
                            stream.write_all(&response_bytes).await?;
                        }
                        HandshakeProcessResult::Completed { response_bytes, remaining_bytes: _ } => {
                            stream.write_all(&response_bytes).await?;
                            handshake_complete = true;
                        }
                    }
                }

                info!("[{id}] RTMP handshake complete");

                // Create RTMP server session
                let session_config = ServerSessionConfig::new();
                let (mut session, initial_results) = ServerSession::new(session_config)
                    .map_err(|e| anyhow::anyhow!("session create error: {:?}", e))?;

                // Send initial responses
                for result in initial_results {
                    if let ServerSessionResult::OutboundResponse(data) = result {
                        stream.write_all(&data.bytes).await?;
                    }
                }

                let mut stream_key_validated = false;
                let appsrc_clone = appsrc.clone();

                // Main RTMP session loop
                loop {
                    let n = match stream.read(&mut buf).await {
                        Ok(0) => { info!("[{id}] RTMP client disconnected"); break; }
                        Ok(n) => n,
                        Err(e) => { warn!("[{id}] RTMP read error: {e}"); break; }
                    };

                    let results = session.handle_input(&buf[..n])
                        .map_err(|e| anyhow::anyhow!("session error: {:?}", e))?;

                    for result in results {
                        match result {
                            ServerSessionResult::OutboundResponse(data) => {
                                stream.write_all(&data.bytes).await?;
                            }
                            ServerSessionResult::RaisedEvent(event) => {
                                match event {
                                    ServerSessionEvent::ConnectionRequested { request_id, .. } => {
                                        let accept_results = session.accept_request(request_id)
                                            .map_err(|e| anyhow::anyhow!("accept error: {:?}", e))?;
                                        for r in accept_results {
                                            if let ServerSessionResult::OutboundResponse(data) = r {
                                                stream.write_all(&data.bytes).await?;
                                            }
                                        }
                                    }
                                    ServerSessionEvent::PublishStreamRequested { request_id, app_name, stream_key, .. } => {
                                        info!("[{id}] publish request: app={app_name} key={stream_key}");
                                        if stream_key == expected_key || expected_key.is_empty() {
                                            stream_key_validated = true;
                                            let accept_results = session.accept_request(request_id)
                                                .map_err(|e| anyhow::anyhow!("accept error: {:?}", e))?;
                                            for r in accept_results {
                                                if let ServerSessionResult::OutboundResponse(data) = r {
                                                    stream.write_all(&data.bytes).await?;
                                                }
                                            }
                                            info!("[{id}] stream key validated, accepting publish");
                                        } else {
                                            warn!("[{id}] invalid stream key: {stream_key}");
                                            break;
                                        }
                                    }
                                    ServerSessionEvent::AudioDataReceived { data, .. } |
                                    ServerSessionEvent::VideoDataReceived { data, .. } => {
                                        if stream_key_validated {
                                            let bytes = Bytes::from(data);
                                            let buffer = gstreamer::Buffer::from_slice(bytes);
                                            let src = appsrc_clone.lock().await;
                                            if let Err(e) = src.push_buffer(buffer) {
                                                warn!("[{id}] appsrc push error: {e}");
                                            }
                                        }
                                    }
                                    ServerSessionEvent::PublishStreamFinished { .. } => {
                                        info!("[{id}] publish stream finished");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                            ServerSessionResult::UnhandleableMessageReceived(_) => {}
                        }
                    }
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("[{id}] SIGINT — stopping");
                break;
            }
        }
    }

    pipeline.set_state(gstreamer::State::Null).ok();
    Ok(())
}
```

- [ ] **Step 3: Register rtmp_listen module in mod.rs**

In `ingest-source/src/sources/mod.rs`, add:

```rust
pub mod encoder;
pub mod test_pattern;
pub mod srt_listen;
pub mod srt_pull;
pub mod rtmp_listen;
```

- [ ] **Step 4: Add RtmpListenConfig and dispatch in main.rs**

In `ingest-source/src/main.rs`, add the config struct after `SrtPullConfig`:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct RtmpListenConfig {
    pub port: u16,
    pub stream_key: String,
    #[serde(default = "default_latency")]
    pub latency_ms: u32,
}
```

Add the field to `SourceConfig`:

```rust
#[derive(Debug, Deserialize)]
struct SourceConfig {
    id: String,
    source_type: String,
    internal_port: u16,
    encoder: Option<EncoderConfig>,
    test_pattern: Option<TestPatternConfig>,
    srt_listen: Option<SrtListenConfig>,
    srt_pull: Option<SrtPullConfig>,
    rtmp_listen: Option<RtmpListenConfig>,
}
```

Add the match arm in `main()` (after the `srt_pull` arm):

```rust
        "rtmp_listen" => {
            let rl = config.rtmp_listen.context("rtmp_listen config missing")?;
            sources::rtmp_listen::run(config.id, config.internal_port, rl).await
        }
```

- [ ] **Step 5: Add gstreamer-app dependency to Cargo.toml**

The `rtmp_listen.rs` uses `gstreamer_app::AppSrc`. Add to `ingest-source/Cargo.toml`:

```toml
gstreamer-app = "0.23"
```

- [ ] **Step 6: Verify Rust compiles**

```bash
cd ingest-source && cargo check
```

Expected: Compiles without errors (GStreamer dev libraries must be installed on the machine).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(rust): add rtmp_listen source worker with stream key validation and GStreamer pipeline"
```

---

## Task 8: Final Integration Verification

- [ ] **Step 1: Full frontend build**

```bash
cd frontend && npm run build
```

Expected: Clean build, no warnings.

- [ ] **Step 2: Full server type check**

```bash
cd server && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Full Rust workspace check**

```bash
cargo check --workspace
```

Expected: Compiles (assuming GStreamer dev libs are available).

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A && git commit -m "chore: final integration fixes for MVP ingest UI redesign"
```
