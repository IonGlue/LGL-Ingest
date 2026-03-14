import { Device } from "../api";

interface Props {
  device: Device;
  onClick: () => void;
}

const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  starting: "Starting",
  streaming: "Streaming",
  stopping: "Stopping",
  error: "Error",
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return d.toLocaleTimeString();
}

function shortId(id: string): string {
  return id.slice(0, 8) + "…" + id.slice(-4);
}

export default function DeviceCard({ device, onClick }: Props) {
  const cs = device.connection_status; // "offline" | "online" | "streaming"
  const stateLabel = STATE_LABELS[device.last_state] ?? device.last_state;

  return (
    <div
      className={`device-card ${cs}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="card-header">
        <div className="card-title">
          <span className={`status-dot dot-${cs}`} />
          <span className="hostname">{device.hostname}</span>
        </div>
        <span className={`state-badge state-${device.last_state}`}>{stateLabel}</span>
      </div>

      <dl className="card-meta">
        <div className="meta-row">
          <dt>Device ID</dt>
          <dd className="mono">{shortId(device.device_id)}</dd>
        </div>
        <div className="meta-row">
          <dt>Version</dt>
          <dd className="mono">{device.version}</dd>
        </div>
        <div className="meta-row">
          <dt>Status</dt>
          <dd className={`conn-status conn-${cs}`}>
            {cs === "streaming" ? "Streaming" : cs === "online" ? "Online" : "Offline"}
          </dd>
        </div>
        <div className="meta-row">
          <dt>Last seen</dt>
          <dd>{formatLastSeen(device.last_seen_at)}</dd>
        </div>
        {device.control_claimed_by && (
          <div className="meta-row">
            <dt>Controlled by</dt>
            <dd className="claimed">Active claim</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
