use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BondPath {
    pub interface: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
}

fn default_priority() -> u32 { 1 }

/// All valid commands that can be sent to a device.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum DeviceCommand {
    Start,
    Stop,
    SetBitrateRange {
        min_kbps: u32,
        max_kbps: u32,
    },
    SetPipeline {
        variant: PipelineVariant,
    },
    /// Full device configuration — everything controllable from the portal.
    SetConfig {
        // Video input
        #[serde(skip_serializing_if = "Option::is_none")]
        capture_device: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pipeline: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resolution: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        framerate: Option<u32>,

        // Encoder
        #[serde(skip_serializing_if = "Option::is_none")]
        bitrate_min_kbps: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bitrate_max_kbps: Option<u32>,

        // SRT destination
        #[serde(skip_serializing_if = "Option::is_none")]
        srt_host: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        srt_port: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        srt_latency_ms: Option<u32>,

        // Bonding
        #[serde(skip_serializing_if = "Option::is_none")]
        bond_enabled: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bond_relay_host: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bond_relay_port: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bond_local_port: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bond_keepalive_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bond_paths: Option<Vec<BondPath>>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineVariant {
    H264V4l2Usb,
    H265V4l2Usb,
    H264Qsv,
}

impl DeviceCommand {
    pub fn validate(&self) -> Result<()> {
        match self {
            DeviceCommand::SetBitrateRange { min_kbps, max_kbps } => {
                if min_kbps > max_kbps {
                    return Err(AppError::InvalidCommand("min_kbps must be <= max_kbps".into()));
                }
                if *max_kbps > 100_000 {
                    return Err(AppError::InvalidCommand("max_kbps exceeds 100000".into()));
                }
            }
            DeviceCommand::SetConfig {
                bitrate_min_kbps, bitrate_max_kbps, framerate, resolution,
                pipeline, srt_port, bond_relay_port, bond_paths, ..
            } => {
                if let (Some(min), Some(max)) = (bitrate_min_kbps, bitrate_max_kbps) {
                    if min > max {
                        return Err(AppError::InvalidCommand("min_kbps must be <= max_kbps".into()));
                    }
                    if *max > 100_000 {
                        return Err(AppError::InvalidCommand("max_kbps exceeds 100000".into()));
                    }
                }
                if let Some(fps) = framerate {
                    if *fps == 0 || *fps > 120 {
                        return Err(AppError::InvalidCommand("framerate must be 1-120".into()));
                    }
                }
                if let Some(res) = resolution {
                    if !res.contains('x') {
                        return Err(AppError::InvalidCommand("resolution must be WxH".into()));
                    }
                }
                if let Some(p) = pipeline {
                    let valid = ["h264_v4l2_usb", "h265_v4l2_usb", "h264_qsv"];
                    if !valid.contains(&p.as_str()) {
                        return Err(AppError::InvalidCommand(format!("unknown pipeline '{p}'")));
                    }
                }
                if let Some(port) = srt_port {
                    if *port == 0 {
                        return Err(AppError::InvalidCommand("srt_port must be non-zero".into()));
                    }
                }
                if let Some(port) = bond_relay_port {
                    if *port == 0 {
                        return Err(AppError::InvalidCommand("bond_relay_port must be non-zero".into()));
                    }
                }
                if let Some(paths) = bond_paths {
                    if paths.is_empty() {
                        return Err(AppError::InvalidCommand("bond_paths must not be empty".into()));
                    }
                    for p in paths {
                        if p.interface.is_empty() {
                            return Err(AppError::InvalidCommand("bond path interface must not be empty".into()));
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn to_wire_json(&self) -> serde_json::Value {
        let mut val = serde_json::to_value(self).unwrap_or_default();
        val["msg_type"] = "command".into();
        val
    }
}
