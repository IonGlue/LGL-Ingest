use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// New-style orchestrate config sections
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub ports: PortsConfig,
    #[serde(default)]
    pub storage: StorageConfig,

    /// Legacy config section (used by local docker-compose dev)
    #[serde(default)]
    pub supervisor: SupervisorConfig,

    #[serde(default)]
    pub source_binary: String,
    #[serde(default)]
    pub dest_binary: String,
    #[serde(default)]
    pub sync_binary: String,
}

/// New-style: `[server]` section from orchestrate-generated config
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_listen")]
    pub listen: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { listen: default_listen() }
    }
}

/// New-style: `[ports]` section from orchestrate-generated config
#[derive(Debug, Clone, Deserialize)]
pub struct PortsConfig {
    #[serde(default = "default_port_start")]
    pub internal_srt_start: u16,
    #[serde(default = "default_port_end")]
    pub internal_srt_end: u16,
}

impl Default for PortsConfig {
    fn default() -> Self {
        Self {
            internal_srt_start: default_port_start(),
            internal_srt_end: default_port_end(),
        }
    }
}

/// New-style: `[storage]` section from orchestrate-generated config
#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_recordings")]
    pub recordings: String,
    #[serde(default = "default_hls")]
    pub hls: String,
    #[serde(default = "default_tmp")]
    pub tmp: String,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            recordings: default_recordings(),
            hls: default_hls(),
            tmp: default_tmp(),
        }
    }
}

/// Legacy: `[supervisor]` section for backwards compatibility with local dev
#[derive(Debug, Clone, Deserialize)]
pub struct SupervisorConfig {
    #[serde(default = "default_api_port")]
    pub api_port: u16,
    #[serde(default = "default_port_start")]
    pub internal_port_start: u16,
    #[serde(default = "default_port_end")]
    pub internal_port_end: u16,
    #[serde(default = "default_max_restarts")]
    pub max_restarts: u32,
    #[serde(default = "default_restart_window_secs")]
    pub restart_window_secs: u64,
}

impl Default for SupervisorConfig {
    fn default() -> Self {
        Self {
            api_port: default_api_port(),
            internal_port_start: default_port_start(),
            internal_port_end: default_port_end(),
            max_restarts: default_max_restarts(),
            restart_window_secs: default_restart_window_secs(),
        }
    }
}

fn default_listen() -> String { "127.0.0.1:9000".to_string() }
fn default_api_port() -> u16 { 9000 }
fn default_port_start() -> u16 { 10000 }
fn default_port_end() -> u16 { 11000 }
fn default_max_restarts() -> u32 { 5 }
fn default_restart_window_secs() -> u64 { 60 }
fn default_recordings() -> String { "/recordings".to_string() }
fn default_hls() -> String { "/var/hls".to_string() }
fn default_tmp() -> String { "/tmp".to_string() }

impl Config {
    pub fn load(path: &str) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let mut config: Self = toml::from_str(&content)?;

        // Default binary paths to current directory
        if config.source_binary.is_empty() {
            config.source_binary = "./ingest-source".to_string();
        }
        if config.dest_binary.is_empty() {
            config.dest_binary = "./ingest-dest".to_string();
        }
        if config.sync_binary.is_empty() {
            config.sync_binary = "./ingest-sync".to_string();
        }

        // Env overrides
        if let Ok(v) = std::env::var("INGEST_SOURCE_BIN") {
            config.source_binary = v;
        }
        if let Ok(v) = std::env::var("INGEST_DEST_BIN") {
            config.dest_binary = v;
        }
        if let Ok(v) = std::env::var("INGEST_SYNC_BIN") {
            config.sync_binary = v;
        }

        Ok(config)
    }

    /// Effective listen address. Uses `[server].listen` if it differs from the
    /// default, otherwise falls back to `127.0.0.1:{supervisor.api_port}`.
    pub fn listen_addr(&self) -> String {
        if self.server.listen != default_listen() {
            self.server.listen.clone()
        } else {
            format!("127.0.0.1:{}", self.supervisor.api_port)
        }
    }

    /// Effective internal SRT port range. Uses `[ports]` if it differs from
    /// defaults, otherwise falls back to `[supervisor]` values.
    pub fn port_range(&self) -> (u16, u16) {
        if self.ports.internal_srt_start != default_port_start()
            || self.ports.internal_srt_end != default_port_end()
        {
            (self.ports.internal_srt_start, self.ports.internal_srt_end)
        } else {
            (self.supervisor.internal_port_start, self.supervisor.internal_port_end)
        }
    }
}
