//! ingest-sync — multi-camera sync coordinator worker.
//!
//! Receives a JSON config on stdin (or a path as argv[1]), builds GStreamer
//! pipelines for each stream, and runs the PCR-based alignment buffer until
//! SIGTERM/SIGINT.

use anyhow::{Context, Result};
use std::io::Read;

mod config;
mod coordinator;
mod pcr;
mod stream;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config: config::SyncConfig = {
        let input = if let Some(path) = std::env::args().nth(1) {
            std::fs::read_to_string(&path)
                .with_context(|| format!("failed to read config: {path}"))?
        } else {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s)?;
            s
        };
        serde_json::from_str(&input).context("failed to parse sync config JSON")?
    };

    log::info!(
        "ingest-sync starting: group={} streams={} target_delay={}ms max_offset={}ms",
        config.id,
        config.streams.len(),
        config.target_delay_ms,
        config.max_offset_ms,
    );

    let coordinator = coordinator::Coordinator::build(config)
        .context("failed to build sync coordinator")?;

    coordinator.run().await
}
