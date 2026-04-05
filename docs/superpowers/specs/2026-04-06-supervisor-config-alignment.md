# Supervisor Config Alignment for Orchestrate

## Overview

Update the ingest-supervisor to read a new TOML config schema that matches what orchestrate generates per tenant. The supervisor currently hardcodes its listen address to `127.0.0.1` and uses a `[supervisor]` config section. Orchestrate needs a `[server]` section with a full listen address and a `[ports]` section for the internal SRT range, plus a `[storage]` section for paths.

## New TOML Schema

```toml
[server]
listen = "0.0.0.0:30010"

[ports]
internal_srt_start = 10000
internal_srt_end = 10199

[storage]
recordings = "/recordings"
hls = "/var/hls"
tmp = "/tmp"
```

## Backwards Compatibility

If the old `[supervisor]` section is present and `[server]` is absent, fall back to old behavior: listen on `127.0.0.1:{api_port}`, use `internal_port_start/end` for the pool. This keeps local `docker-compose` development working without changing the existing `ingest-supervisor/config.toml`.

## Changes

### `ingest-supervisor/src/config.rs`

Add new config structs:

```rust
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ServerConfig {
    #[serde(default = "default_listen")]
    pub listen: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PortsConfig {
    #[serde(default = "default_port_start")]
    pub internal_srt_start: u16,
    #[serde(default = "default_port_end")]
    pub internal_srt_end: u16,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct StorageConfig {
    #[serde(default = "default_recordings")]
    pub recordings: String,
    #[serde(default = "default_hls")]
    pub hls: String,
    #[serde(default = "default_tmp")]
    pub tmp: String,
}
```

Add these fields to `Config` alongside the existing `supervisor` field. In `Config::load()`, after parsing, resolve the effective listen address and port range:

- If `server.listen` is set and non-default, use it
- Else fall back to `127.0.0.1:{supervisor.api_port}`

Similarly for port ranges:
- If `ports.internal_srt_start` is set, use it
- Else fall back to `supervisor.internal_port_start/end`

Expose helper methods: `Config::listen_addr() -> String`, `Config::port_range() -> (u16, u16)`, `Config::storage() -> &StorageConfig`.

### `ingest-supervisor/src/main.rs`

Replace:
```rust
let api_addr = format!("127.0.0.1:{}", config.supervisor.api_port);
```

With:
```rust
let api_addr = config.listen_addr();
```

Replace port pool construction to use `config.port_range()`.

### `Dockerfile.supervisor`

Fix CMD from:
```dockerfile
CMD ["ingest-supervisor", "--config", "/etc/ingest-supervisor/config.toml"]
```

To:
```dockerfile
CMD ["ingest-supervisor", "/etc/ingest-supervisor/config.toml"]
```

This matches the positional arg parsing in `main.rs`.

### No TS Server Changes

`SUPERVISOR_API_URL` is already read from env in `server/src/config.ts:30`. Orchestrate sets this to point at the supervisor's listen address.

### No Frontend Changes

Ingest URLs already use `window.location.hostname`.

## Files to Modify

- `ingest-supervisor/src/config.rs` — new config structs, fallback logic, helper methods
- `ingest-supervisor/src/main.rs` — use config helpers instead of hardcoded values
- `ingest-supervisor/config.toml` — update example to show both old and new schema
- `Dockerfile.supervisor` — fix CMD positional arg

## Files Unchanged

- `server/src/config.ts` — already reads `SUPERVISOR_API_URL` from env
- All frontend files — already use `window.location.hostname`
