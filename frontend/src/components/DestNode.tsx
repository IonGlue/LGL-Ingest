import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Tv, Rss, Globe, HardDrive, RefreshCw, CircleDashed, type LucideIcon } from 'lucide-react'
import type { Destination } from '../api.js'

const TYPE_ICON: Record<string, LucideIcon> = {
  rtmp:        Tv,
  srt_push:    Rss,
  hls:         Globe,
  recorder:    HardDrive,
  lgl_ingest:  RefreshCw,
  placeholder: CircleDashed,
}

const STATUS_COLOR: Record<string, string> = {
  active:      '#10B981',
  waiting:     '#F59E0B',
  error:       '#EF4444',
  idle:        '#8E8E9F',
  placeholder: '#E5E5EA',
}

export default function DestNode({ data }: NodeProps) {
  const dest = data as unknown as Destination
  const Icon = TYPE_ICON[dest.dest_type] ?? Tv
  const color = STATUS_COLOR[dest.status] ?? '#8E8E9F'
  const isPlaceholder = dest.dest_type === 'placeholder'

  return (
    <div style={{
      background: '#FFFFFF',
      border: `2px solid ${isPlaceholder ? '#E5E5EA' : color}`,
      borderStyle: isPlaceholder ? 'dashed' : 'solid',
      borderRadius: 10,
      padding: '12px 16px',
      minWidth: 200,
      position: 'relative',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Input handle — left side */}
      <Handle type="target" position={Position.Left} style={{ background: color, width: 12, height: 12 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={16} color={color} />
        <span style={{ fontWeight: 600, fontSize: 14, color: '#1A1A2E' }}>{dest.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 11, color: '#8E8E9F', textTransform: 'uppercase', fontFamily: "'Courier New', monospace" }}>
          {dest.dest_type.replace('_', ' ')} · {dest.status}
        </span>
      </div>
    </div>
  )
}
