import { useState, useEffect, useRef } from "react";
import { api, ApiError, Device, LiveTelemetry, DeviceConfig } from "../api";

interface Props {
  device: Device;
  onClose: () => void;
  isAdmin: boolean;
}

const PIPELINES = [
  { value: "h264_v4l2_usb", label: "H.264 V4L2 USB" },
  { value: "h265_v4l2_usb", label: "H.265 V4L2 USB" },
  { value: "h264_qsv", label: "H.264 Intel QSV" },
];

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}{unit && <span className="stat-unit"> {unit}</span>}</span>
    </div>
  );
}

export default function DeviceDetail({ device, onClose, isAdmin }: Props) {
  const [telemetry, setTelemetry] = useState<LiveTelemetry | null>(null);
  const [tab, setTab] = useState<"overview" | "network" | "settings" | "control">("overview");
  const [cmdBusy, setCmdBusy] = useState(false);
  const [cmdMsg, setCmdMsg] = useState<string | null>(null);

  // Settings form state
  const [config, setConfig] = useState<DeviceConfig>({});
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Live telemetry via WebSocket stream
  useEffect(() => {
    const url = api.telemetryStreamUrl(device.id);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "telemetry") {
          setTelemetry(msg.data as LiveTelemetry);
          // Pre-populate config form from telemetry on first load
          if (!config.pipeline && msg.data.encoder) {
            setConfig((prev) => ({
              pipeline: prev.pipeline ?? msg.data.encoder.pipeline,
              resolution: prev.resolution ?? msg.data.encoder.resolution,
              ...prev,
            }));
          }
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => {
      // Fall back to REST polling
      const poll = setInterval(async () => {
        try {
          const t = await api.liveTelemetry(device.id);
          setTelemetry(t);
        } catch { /* ignore */ }
      }, 1000);
      return () => clearInterval(poll);
    };

    return () => {
      ws.close();
    };
  }, [device.id]);

  async function sendCmd(cmd: object) {
    setCmdBusy(true);
    setCmdMsg(null);
    try {
      // Claim control first, ignore if already claimed by us
      await api.claimControl(device.id).catch(() => {});
      await api.sendCommand(device.id, cmd);
      setCmdMsg("Command sent.");
    } catch (e) {
      setCmdMsg(e instanceof ApiError ? e.message : "Command failed");
    } finally {
      setCmdBusy(false);
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setConfigBusy(true);
    setConfigMsg(null);
    try {
      await api.claimControl(device.id).catch(() => {});
      await api.setConfig(device.id, config);
      setConfigMsg("Configuration saved and applied.");
    } catch (e) {
      setConfigMsg(e instanceof ApiError ? e.message : "Failed to save config");
    } finally {
      setConfigBusy(false);
    }
  }

  const statusLabel = device.connection_status === "streaming"
    ? "Streaming"
    : device.connection_status === "online"
      ? "Online"
      : "Offline";

  const statusClass = device.connection_status;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-row">
            <span className={`status-dot dot-${statusClass}`} />
            <h2 className="modal-title">{device.hostname}</h2>
            <span className={`state-badge state-${statusClass}`}>{statusLabel}</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          {(["overview", "network", "settings", "control"] as const).map((t) => (
            <button
              key={t}
              className={`tab-btn ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {/* ── Overview ── */}
          {tab === "overview" && (
            <div>
              <div className="stat-grid">
                <Stat label="Device ID" value={device.device_id.slice(0, 16) + "…"} />
                <Stat label="Version" value={device.version} />
                <Stat label="Enrollment" value={device.enrollment_state} />
                {telemetry && (
                  <>
                    <Stat label="Uptime" value={formatUptime(telemetry.uptime_secs)} />
                    <Stat label="State" value={telemetry.state} />
                    <Stat label="Pipeline" value={telemetry.encoder.pipeline} />
                    <Stat label="Resolution" value={telemetry.encoder.resolution} />
                    <Stat label="Encoder bitrate" value={telemetry.encoder.bitrate_kbps} unit="kbps" />
                    <Stat label="FPS" value={telemetry.encoder.fps.toFixed(1)} />
                    <Stat label="Telemetry age" value={telemetry.age_ms} unit="ms" />
                  </>
                )}
                {!telemetry && device.status === "offline" && (
                  <p className="status-msg">Device is offline — no telemetry available.</p>
                )}
                {!telemetry && device.status === "online" && (
                  <p className="status-msg">Waiting for telemetry…</p>
                )}
              </div>
            </div>
          )}

          {/* ── Network ── */}
          {tab === "network" && (
            <div>
              {telemetry && telemetry.paths.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>Bitrate</th>
                      <th>RTT</th>
                      <th>Loss</th>
                      <th>In-flight</th>
                      <th>Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetry.paths.map((p) => (
                      <tr key={p.interface}>
                        <td className="mono">{p.interface}</td>
                        <td>{p.bitrate_kbps.toLocaleString()} kbps</td>
                        <td className={p.rtt_ms > 100 ? "val-warn" : ""}>{p.rtt_ms.toFixed(1)} ms</td>
                        <td className={p.loss_pct > 1 ? "val-warn" : ""}>{p.loss_pct.toFixed(2)}%</td>
                        <td>{p.in_flight}</td>
                        <td>{p.window.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="status-msg">
                  {telemetry ? "No bonded paths active." : "No telemetry yet."}
                </p>
              )}
              {telemetry && (
                <div className="stat-grid" style={{ marginTop: 20 }}>
                  <Stat
                    label="Total bitrate"
                    value={telemetry.paths.reduce((s, p) => s + p.bitrate_kbps, 0).toLocaleString()}
                    unit="kbps"
                  />
                  <Stat label="Active paths" value={telemetry.paths.length} />
                </div>
              )}
            </div>
          )}

          {/* ── Settings ── */}
          {tab === "settings" && (
            <form className="settings-form" onSubmit={handleSaveConfig}>
              <div className="settings-grid">
                <div className="field">
                  <label>Pipeline</label>
                  <select
                    className="select-input"
                    value={config.pipeline ?? ""}
                    onChange={(e) => setConfig({ ...config, pipeline: e.target.value })}
                  >
                    <option value="">— unchanged —</option>
                    {PIPELINES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Resolution</label>
                  <select
                    className="select-input"
                    value={config.resolution ?? ""}
                    onChange={(e) => setConfig({ ...config, resolution: e.target.value || undefined })}
                  >
                    <option value="">— unchanged —</option>
                    <option>1920x1080</option>
                    <option>1280x720</option>
                    <option>854x480</option>
                    <option>640x360</option>
                  </select>
                </div>

                <div className="field">
                  <label>Framerate (fps)</label>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    max={60}
                    placeholder="e.g. 30"
                    value={config.framerate ?? ""}
                    onChange={(e) => setConfig({ ...config, framerate: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>

                <div className="field">
                  <label>Capture device</label>
                  <input
                    className="text-input"
                    type="text"
                    placeholder="/dev/video0"
                    value={config.capture_device ?? ""}
                    onChange={(e) => setConfig({ ...config, capture_device: e.target.value || undefined })}
                  />
                </div>

                <div className="field">
                  <label>Min bitrate (kbps)</label>
                  <input
                    className="text-input"
                    type="number"
                    min={100}
                    max={100000}
                    placeholder="e.g. 2000"
                    value={config.bitrate_min_kbps ?? ""}
                    onChange={(e) => setConfig({ ...config, bitrate_min_kbps: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>

                <div className="field">
                  <label>Max bitrate (kbps)</label>
                  <input
                    className="text-input"
                    type="number"
                    min={100}
                    max={100000}
                    placeholder="e.g. 8000"
                    value={config.bitrate_max_kbps ?? ""}
                    onChange={(e) => setConfig({ ...config, bitrate_max_kbps: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>
              </div>

              {configMsg && (
                <p className={configMsg.startsWith("Config") ? "cmd-success" : "cmd-error"}>
                  {configMsg}
                </p>
              )}

              <div className="settings-actions">
                {isAdmin && (
                  <button type="submit" className="btn btn-primary" style={{ width: "auto" }} disabled={configBusy}>
                    {configBusy ? "Applying…" : "Apply settings"}
                  </button>
                )}
                {!isAdmin && <p className="status-msg">Admin role required to change settings.</p>}
              </div>
            </form>
          )}

          {/* ── Control ── */}
          {tab === "control" && (
            <div>
              <div className="control-grid">
                <button
                  className="btn btn-success"
                  onClick={() => sendCmd({ cmd: "start" })}
                  disabled={cmdBusy}
                >
                  ▶ Start Encoder
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => sendCmd({ cmd: "stop" })}
                  disabled={cmdBusy}
                >
                  ■ Stop Encoder
                </button>
              </div>

              <div className="control-section">
                <h3 className="control-section-title">Bitrate Range</h3>
                <BitrateControl onSend={sendCmd} busy={cmdBusy} telemetry={telemetry} />
              </div>

              {cmdMsg && (
                <p className={cmdMsg === "Command sent." ? "cmd-success" : "cmd-error"}>
                  {cmdMsg}
                </p>
              )}

              {!isAdmin && (
                <p className="status-msg" style={{ marginTop: 16 }}>
                  Note: Commands auto-acquire a 5-minute control claim.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bitrate control sub-component ─────────────────────────────────────────────

function BitrateControl({
  onSend,
  busy,
  telemetry,
}: {
  onSend: (cmd: object) => void;
  busy: boolean;
  telemetry: LiveTelemetry | null;
}) {
  const [min, setMin] = useState(
    telemetry ? String(Math.round(telemetry.encoder.bitrate_kbps * 0.5)) : "2000"
  );
  const [max, setMax] = useState(
    telemetry ? String(telemetry.encoder.bitrate_kbps) : "8000"
  );

  return (
    <div className="bitrate-control">
      <div className="bitrate-inputs">
        <div className="field">
          <label>Min (kbps)</label>
          <input
            className="text-input"
            type="number"
            min={100}
            max={100000}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Max (kbps)</label>
          <input
            className="text-input"
            type="number"
            min={100}
            max={100000}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </div>
      </div>
      <button
        className="btn btn-secondary"
        onClick={() =>
          onSend({
            cmd: "set_bitrate_range",
            min_kbps: Number(min),
            max_kbps: Number(max),
          })
        }
        disabled={busy}
        style={{ width: "auto" }}
      >
        Set bitrate range
      </button>
    </div>
  );
}
