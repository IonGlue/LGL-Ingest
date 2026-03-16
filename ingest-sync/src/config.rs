//! Configuration for the ingest-sync worker.
//!
//! The supervisor passes a JSON blob that describes:
//!  - The N source internal ports to read from
//!  - The N corresponding output (aligned) ports to serve
//!  - The target buffer delay (configurable per sync group)

use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct SyncConfig {
    /// Unique ID for this sync group (used in log messages).
    pub id: String,

    /// Streams to synchronise.  Order matters: index 0's output_port matches
    /// index 0's source_port.
    pub streams: Vec<StreamConfig>,

    /// Total minimum delay (ms) added to **every** output stream.
    /// Must be larger than the worst-case one-way network jitter in your
    /// deployment.  200 ms is fine on a LAN; use 1000–1500 ms for
    /// intercontinental links.
    #[serde(default = "default_target_delay_ms")]
    pub target_delay_ms: u32,

    /// Maximum tolerated offset between streams (ms).  If a stream's PCR
    /// falls more than this far behind the reference, it is treated as
    /// disconnected and the buffer is reset.
    #[serde(default = "default_max_offset_ms")]
    pub max_offset_ms: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StreamConfig {
    /// ID of the source slot (used in log messages).
    pub source_id: String,
    /// Internal SRT port where this source's stream can be read
    /// (destinations normally connect here; the sync worker connects instead).
    pub source_port: u16,
    /// SRT listener port the sync worker will serve the *aligned* stream on.
    /// Destinations in the sync group connect to this port instead.
    pub output_port: u16,
}

fn default_target_delay_ms() -> u32 { 500 }
fn default_max_offset_ms() -> u32 { 2000 }
