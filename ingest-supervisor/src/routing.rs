use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

// ── Sync groups ───────────────────────────────────────────────────────────────

/// A sync group collects N sources and aligns them to a common timeline.
///
/// When a sync group is active:
///   - An `ingest-sync` worker process is spawned.
///   - Each member source is assigned an `aligned_port` (allocated from the
///     port pool by the supervisor).
///   - Destinations that are routed to a member source receive the stream
///     from `aligned_port` instead of `source.internal_port`, so they
///     transparently see the aligned feed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncGroup {
    pub id: String,
    pub name: String,
    /// Minimum buffering added to every stream (ms).
    /// Set higher for intercontinental deployments (e.g. 1000–1500 ms).
    pub target_delay_ms: u32,
    /// Maximum tolerated offset between streams (ms) before a stream is
    /// considered desynchronised and its buffer reset.
    pub max_offset_ms: u32,
    /// Source IDs that belong to this group.
    pub source_ids: Vec<String>,
    /// Runtime: mapping from source_id → aligned output port.
    /// Populated by the supervisor when the sync worker is spawned.
    #[serde(default)]
    pub aligned_ports: HashMap<String, u16>,
    pub status: SyncGroupStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SyncGroupStatus {
    Idle,
    Active,
    Error,
}

/// Represents a source slot in the patchbay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceSlot {
    pub id: String,
    pub name: String,
    pub source_type: String,  // encoder | test_pattern | srt_listen | srt_pull | placeholder
    pub config: serde_json::Value,
    pub internal_port: Option<u16>,
    pub status: SourceStatus,
    pub process_pid: Option<u32>,
    pub position_x: f32,
    pub position_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Idle,
    Starting,
    Active,
    Error,
    Placeholder,
}

/// Represents a destination slot in the patchbay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DestSlot {
    pub id: String,
    pub name: String,
    pub dest_type: String,  // rtmp | srt_push | hls | recorder | placeholder
    pub config: serde_json::Value,
    pub status: DestStatus,
    pub process_pid: Option<u32>,
    pub position_x: f32,
    pub position_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DestStatus {
    Idle,
    Starting,
    Active,
    Error,
    Placeholder,
}

/// A routing entry: one source → one destination.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingEntry {
    pub id: String,
    pub source_id: String,
    pub dest_id: String,
    pub enabled: bool,
}

/// Minimal snapshot passed to supervisor methods that only need source info.
pub struct RoutingSnapshot {
    pub sources: HashMap<String, SourceSlot>,
}

/// In-memory routing state (persisted to DB via the TypeScript server).
pub struct RoutingTable {
    pub sources: HashMap<String, SourceSlot>,
    pub dests: HashMap<String, DestSlot>,
    pub routes: Vec<RoutingEntry>,
    pub sync_groups: HashMap<String, SyncGroup>,
}

impl RoutingTable {
    pub fn new() -> Self {
        Self {
            sources: HashMap::new(),
            dests: HashMap::new(),
            routes: Vec::new(),
            sync_groups: HashMap::new(),
        }
    }

    /// Return a lightweight snapshot sufficient for the supervisor to spawn a
    /// sync worker (only sources and sync_groups are needed).
    pub fn clone_for_sync(&self) -> RoutingSnapshot {
        RoutingSnapshot {
            sources: self.sources.clone(),
        }
    }

    pub fn add_source(&mut self, source: SourceSlot) {
        self.sources.insert(source.id.clone(), source);
    }

    pub fn remove_source(&mut self, id: &str) {
        self.sources.remove(id);
        // Remove any routes that reference this source
        self.routes.retain(|r| r.source_id != id);
    }

    pub fn add_dest(&mut self, dest: DestSlot) {
        self.dests.insert(dest.id.clone(), dest);
    }

    pub fn remove_dest(&mut self, id: &str) {
        self.dests.remove(id);
        self.routes.retain(|r| r.dest_id != id);
    }

    pub fn add_route(&mut self, route: RoutingEntry) {
        // Prevent duplicates
        if !self.routes.iter().any(|r| r.source_id == route.source_id && r.dest_id == route.dest_id) {
            self.routes.push(route);
        }
    }

    pub fn remove_route(&mut self, route_id: &str) {
        self.routes.retain(|r| r.id != route_id);
    }

    /// Get all destination IDs connected to a given source.
    pub fn dests_for_source(&self, source_id: &str) -> Vec<String> {
        self.routes
            .iter()
            .filter(|r| r.source_id == source_id && r.enabled)
            .map(|r| r.dest_id.clone())
            .collect()
    }

    /// Get source ID connected to a given destination.
    pub fn source_for_dest(&self, dest_id: &str) -> Option<String> {
        self.routes
            .iter()
            .find(|r| r.dest_id == dest_id && r.enabled)
            .map(|r| r.source_id.clone())
    }

    // ── Sync group helpers ────────────────────────────────────────────────

    pub fn add_sync_group(&mut self, group: SyncGroup) {
        self.sync_groups.insert(group.id.clone(), group);
    }

    pub fn remove_sync_group(&mut self, id: &str) {
        self.sync_groups.remove(id);
    }

    /// Find the sync group that contains the given source, if any.
    pub fn sync_group_for_source(&self, source_id: &str) -> Option<&SyncGroup> {
        self.sync_groups
            .values()
            .find(|g| g.source_ids.contains(&source_id.to_string()))
    }

    /// Return the aligned (sync-coordinator output) port for a source, or its
    /// raw `internal_port` if it is not part of an active sync group.
    pub fn effective_port_for_source(&self, source_id: &str) -> Option<u16> {
        // Check if this source is in an active sync group with an aligned port.
        if let Some(group) = self.sync_group_for_source(source_id) {
            if group.status == SyncGroupStatus::Active {
                if let Some(&port) = group.aligned_ports.get(source_id) {
                    return Some(port);
                }
            }
        }
        // Fall back to the raw internal port.
        self.sources.get(source_id).and_then(|s| s.internal_port)
    }

    /// Get all active source IDs.
    pub fn active_source_ids(&self) -> HashSet<String> {
        self.routes
            .iter()
            .filter(|r| r.enabled)
            .map(|r| r.source_id.clone())
            .collect()
    }
}
