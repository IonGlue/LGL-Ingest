# MVP Ingest UI Redesign

## Overview

Restructure the LGL Ingest frontend from a two-tab layout (Rack / Redistribute) to a three-tab layout (Rack / Ingest / Destinations). Add RTMP ingest as a new source type. Remove the Redistribute view entirely.

The Rack remains the primary interface where everything can be done quickly. The Ingest and Destinations tabs provide expanded detail views with more configuration options.

## Navigation

Replace the current `Rack | Redistribute` toggle with three tabs:

- **Rack** (default, landing page)
- **Ingest**
- **Destinations**

Delete the Redistribute view (`Redistribute.tsx`) and its add panel (`AddRedistributePanel.tsx`).

## Tab 1: Rack

Keep the existing dual 19" rack patchbay exactly as-is: SVG bezier cables, status LEDs, click-to-patch workflow, start/stop/delete per slot.

### Changes

**Add Source panel** — add a dropdown at the top to pick from sources already configured in the Ingest tab. User can still create new sources inline (which also makes them appear in the Ingest tab).

**Add Destination panel** — same pattern: dropdown to pick from pre-configured destinations, or create new inline.

**Click a rack slot** — opens an edit modal with key settings (name, status, start/stop). Includes a "Full settings" link that navigates to the corresponding Ingest or Destinations tab for that item.

### Patching

Patching workflow unchanged: click source slot, click destination slot, route created. SVG cables rendered between connected pairs. Delete via midpoint button on cable.

## Tab 2: Ingest

A list/card view of all configured ingest sources.

### Card Display

Each card shows:

- Name (e.g., "Main Camera")
- Type badge: `RTMP` or `SRT`
- Ingest URL — full copyable URL (e.g., `rtmp://host:port/live/{stream_key}` or `srt://host:{port}`)
- Stream key (RTMP only) — masked by default, reveal/copy buttons
- Status indicator (idle / active / error)
- Port number

### Actions

- **"+ Add Source"** button — opens create form
- **Click a card** — opens edit modal with full settings (name, type, port, latency, stream key regeneration)
- **Delete** button per card

### RTMP Source Creation

1. User enters name, selects type "RTMP"
2. System auto-generates a stream key (UUID v4)
3. Port assigned from supervisor port pool
4. User receives copyable `rtmp://host:port/live/{stream_key}` URL

### SRT Source Creation

1. User enters name, selects type "SRT"
2. User optionally configures port, passphrase, latency
3. Port auto-assigned if not specified
4. User receives copyable `srt://host:{port}` URL

### MVP Source Types Exposed

Only these types in the Ingest tab UI:

- `rtmp_listen` (new) — accept incoming RTMP pushes
- `srt_listen` (existing) — accept incoming SRT pushes

Other types (`encoder`, `srt_pull`, `rtmp_pull`, `test_pattern`, `placeholder`) remain in the codebase and Rack inline-create panel but are not featured in the Ingest tab for MVP.

## Tab 3: Destinations

Same list/card layout as Ingest.

### Card Display

Each card shows:

- Name (e.g., "YouTube Company Name")
- Type badge: `RTMP` or `SRT`
- Destination URL — masked stream key with reveal/copy
- Status indicator (idle / active / error)
- Platform icon — auto-detected from URL (YouTube, Twitch, Facebook, or generic)

### Actions

- **"+ Add Destination"** button — opens create form
- **Click a card** — opens edit modal with full settings
- **Delete** button per card

### RTMP Destination Creation

1. User enters name (e.g., "YouTube Main Channel")
2. Enters RTMP URL + stream key (provided by the streaming platform)
3. Platform auto-detected from URL (reuse logic from existing Redistribute component)

### SRT Destination Creation

1. User enters name, host, port, latency

### MVP Destination Types Exposed

Only these types in the Destinations tab UI:

- `rtmp` (existing) — push RTMP to streaming platforms
- `srt_push` (existing) — push SRT to remote endpoint

Other types (`hls`, `recorder`, `lgl_ingest`, `placeholder`) remain in the codebase but are not exposed in the Destinations tab for MVP.

## Backend: New RTMP Ingest Source

### New Rust Worker: `rtmp_listen`

A new source worker at `ingest-source/src/sources/rtmp_listen.rs`.

**Behavior:**

- Starts an RTMP server listener on an assigned port
- Accepts incoming RTMP streams, validates against the stream key via the URL path (`/live/{stream_key}`)
- Demuxes FLV, parses H.264, muxes to MPEG-TS, re-exposes as SRT on the internal port
- GStreamer pipeline: `rtmpsrc (server mode) → flvdemux → h264parse → mpegtsmux → srtsink`

**Config shape:**

```json
{
  "port": 1935,
  "stream_key": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "auto_generated_key": true
}
```

### TypeScript Server Changes

- Add `rtmp_listen` to `VALID_SOURCE_TYPES` array in `server/src/api/sources.ts`
- On creation of `rtmp_listen` source: auto-generate UUID v4 stream key, store in `config.stream_key`
- New endpoint: `GET /api/sources/:id/ingest-url` — returns the full ingest URL for any source type

### Stream Key Generation

- Auto-generated as UUID v4 on source creation
- Stored in `sources.config` JSONB field as `stream_key`
- Can be regenerated via PATCH with `config.regenerate_key: true`

## Files to Delete

- `frontend/src/components/Redistribute.tsx`
- `frontend/src/components/AddRedistributePanel.tsx`

## Files to Create

- `ingest-source/src/sources/rtmp_listen.rs` — new RTMP listen source worker
- `frontend/src/components/IngestView.tsx` — Ingest tab component
- `frontend/src/components/DestinationsView.tsx` — Destinations tab component
- `frontend/src/components/EditSourceModal.tsx` — edit modal for sources
- `frontend/src/components/EditDestModal.tsx` — edit modal for destinations

## Files to Modify

- `frontend/src/App.tsx` — three-tab navigation, remove Redistribute
- `frontend/src/components/RackPatchbay.tsx` — add preset dropdown to Add panels, add click-to-edit modal on slots
- `frontend/src/components/AddSourcePanel.tsx` — add preset picker dropdown
- `frontend/src/components/AddDestPanel.tsx` — add preset picker dropdown
- `frontend/src/api.ts` — add ingest-url endpoint call
- `server/src/api/sources.ts` — add `rtmp_listen` type, stream key generation, ingest-url endpoint
- `ingest-source/src/sources/mod.rs` — register `rtmp_listen` module
- `ingest-source/src/main.rs` — add `rtmp_listen` config and dispatch

## Design Constraints

- All styling: inline React.CSSProperties (no CSS framework)
- Color tokens: match existing palette (violet #8B5CF6 primary, green #10B981 active, etc.)
- Icons: lucide-react
- No new dependencies unless strictly necessary
- Polling: 5-second interval for status updates (existing pattern)
