use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::sync::RwLock;

mod config;
mod supervisor;
mod routing;
mod port_pool;
mod api;

use config::Config;
use supervisor::Supervisor;
use routing::RoutingTable;
use port_pool::PortPool;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config_path = std::env::args().nth(1)
        .unwrap_or_else(|| "config/ingest.toml".to_string());

    let config = Config::load(&config_path)
        .with_context(|| format!("failed to load config: {config_path}"))?;

    let listen_addr = config.listen_addr();
    let (port_start, port_end) = config.port_range();

    log::info!("LGL Ingest supervisor starting");
    log::info!("  supervisor API: {listen_addr}");
    log::info!("  internal port range: {port_start}-{port_end}");
    log::info!("  storage: recordings={}, hls={}, tmp={}",
        config.storage.recordings, config.storage.hls, config.storage.tmp);

    let port_pool = Arc::new(RwLock::new(PortPool::new(port_start, port_end)));

    let routing = Arc::new(RwLock::new(RoutingTable::new()));

    let supervisor = Arc::new(RwLock::new(Supervisor::new(
        config.clone(),
        port_pool.clone(),
        routing.clone(),
    )));

    // Start the supervision loop in background.
    // It takes the Arc directly and acquires the lock only briefly per tick,
    // so API handlers are never blocked waiting for the supervision lock.
    let sup_clone = supervisor.clone();
    tokio::spawn(async move {
        if let Err(e) = supervisor::run_supervision_loop(sup_clone).await {
            log::error!("supervision loop error: {e}");
        }
    });

    // Start the REST API
    log::info!("starting supervisor API on {listen_addr}");

    api::serve(listen_addr, supervisor, routing, port_pool).await
}
