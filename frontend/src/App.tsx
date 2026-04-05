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
