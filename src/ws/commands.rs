use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

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
    /// Update encoder config (writes to device's config file + restarts encoder).
    SetConfig {
        #[serde(skip_serializing_if = "Option::is_none")]
        pipeline: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resolution: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        framerate: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bitrate_min_kbps: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bitrate_max_kbps: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        capture_device: Option<String>,
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
                    return Err(AppError::InvalidCommand(
                        "min_kbps must be <= max_kbps".to_string(),
                    ));
                }
                if *max_kbps > 100_000 {
                    return Err(AppError::InvalidCommand(
                        "max_kbps exceeds 100000".to_string(),
                    ));
                }
            }
            DeviceCommand::SetConfig { bitrate_min_kbps, bitrate_max_kbps, framerate, resolution, pipeline, .. } => {
                if let (Some(min), Some(max)) = (bitrate_min_kbps, bitrate_max_kbps) {
                    if min > max {
                        return Err(AppError::InvalidCommand("min_kbps must be <= max_kbps".to_string()));
                    }
                    if *max > 100_000 {
                        return Err(AppError::InvalidCommand("max_kbps exceeds 100000".to_string()));
                    }
                }
                if let Some(fps) = framerate {
                    if *fps == 0 || *fps > 120 {
                        return Err(AppError::InvalidCommand("framerate must be 1-120".to_string()));
                    }
                }
                if let Some(res) = resolution {
                    if !res.contains('x') {
                        return Err(AppError::InvalidCommand("resolution must be WxH format".to_string()));
                    }
                }
                if let Some(p) = pipeline {
                    let valid = ["h264_v4l2_usb", "h265_v4l2_usb", "h264_qsv"];
                    if !valid.contains(&p.as_str()) {
                        return Err(AppError::InvalidCommand(format!("unknown pipeline '{p}'")));
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// Serialize to the wire format the device expects.
    pub fn to_wire_json(&self) -> serde_json::Value {
        let mut val = serde_json::to_value(self).unwrap_or_default();
        val["msg_type"] = "command".into();
        val
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitrate_range_validation() {
        let cmd = DeviceCommand::SetBitrateRange { min_kbps: 5000, max_kbps: 2000 };
        assert!(cmd.validate().is_err());

        let cmd = DeviceCommand::SetBitrateRange { min_kbps: 2000, max_kbps: 200_000 };
        assert!(cmd.validate().is_err());

        let cmd = DeviceCommand::SetBitrateRange { min_kbps: 2000, max_kbps: 8000 };
        assert!(cmd.validate().is_ok());
    }

    #[test]
    fn test_wire_format_has_msg_type() {
        let cmd = DeviceCommand::Start;
        let json = cmd.to_wire_json();
        assert_eq!(json["msg_type"], "command");
        assert_eq!(json["cmd"], "start");
    }

    #[test]
    fn test_set_config_validation() {
        let cmd = DeviceCommand::SetConfig {
            pipeline: Some("h264_v4l2_usb".to_string()),
            resolution: Some("1920x1080".to_string()),
            framerate: Some(30),
            bitrate_min_kbps: Some(2000),
            bitrate_max_kbps: Some(8000),
            capture_device: None,
        };
        assert!(cmd.validate().is_ok());
    }
}
