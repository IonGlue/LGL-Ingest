use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tokio::time::{interval, timeout};
use tracing::{error, info, warn, debug};
use uuid::Uuid;

use crate::{
    auth::jwt::generate_device_token,
    models::{
        audit::AuditLog,
        device::Device,
        telemetry::{TelemetryRecord, TelemetryReport},
    },
    AppState,
};

#[derive(Debug, Deserialize)]
struct RegisterMsg {
    msg_type: String,
    device_id: String,
    hardware_id: String,
    hostname: String,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "msg_type", rename_all = "snake_case")]
enum DeviceMessage {
    Register(RegisterMsg),
    Telemetry(TelemetryReport),
    #[serde(other)]
    Unknown,
}

pub async fn handle_device_ws(ws: WebSocket, state: AppState) {
    let (mut ws_tx, mut ws_rx) = ws.split();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(64);

    // Spawn a task to forward outbound messages to the WebSocket
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // 1. Wait for registration message (10s timeout)
    let first_msg = match timeout(Duration::from_secs(10), ws_rx.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => text,
        _ => {
            warn!("device did not send registration in time");
            return;
        }
    };

    let register: RegisterMsg = match serde_json::from_str::<RegisterMsg>(&first_msg) {
        Ok(msg) if msg.msg_type == "register" => msg,
        _ => {
            warn!("device sent unexpected first message");
            return;
        }
    };

    info!(device_id = %register.device_id, "device registering");

    // 2. Register or update device in DB
    let (device, is_new) = match Device::register_or_update(
        &register.device_id,
        &register.hardware_id,
        &register.hostname,
        &register.version,
        &state.db,
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            error!("failed to register device: {e}");
            return;
        }
    };

    // 3. Audit log
    let action = if is_new { "device.register" } else { "device.reconnect" };
    let _ = AuditLog::log_device_event(
        &state.db,
        device.id,
        action,
        Some(json!({ "hostname": device.hostname, "version": device.version })),
    )
    .await;

    // 4. Check enrollment state
    match device.enrollment_state.as_str() {
        "rejected" => {
            warn!(device_id = %device.device_id, "rejected device attempted to connect");
            let _ = tx.send(json!({ "msg_type": "enrollment_rejected" }).to_string()).await;
            return;
        }
        "pending" => {
            info!(device_id = %device.device_id, "device in pending enrollment state");
            let code = device.enrollment_code.clone().unwrap_or_default();
            let _ = tx.send(json!({
                "msg_type": "enrollment_pending",
                "code": code,
                "device_uuid": device.id,
            }).to_string()).await;

            // Wait in enrollment loop until approved/rejected
            let enrolled = wait_for_enrollment(
                device.id,
                &device.device_id,
                &code,
                &state,
                &tx,
                &mut ws_rx,
            )
            .await;

            if !enrolled {
                return;
            }

            // Re-fetch device to get updated enrollment state
            let device = match Device::find_by_id(device.id, &state.db).await {
                Ok(Some(d)) => d,
                _ => return,
            };

            // Now proceed to main loop with this enrolled device
            run_main_loop(device, state, tx, ws_rx).await;
        }
        _ => {
            // enrolled — proceed normally
            run_main_loop(device, state, tx, ws_rx).await;
        }
    }
}

/// Keep the device connected while waiting for admin to approve/reject enrollment.
/// Returns true if approved, false if rejected or disconnected.
async fn wait_for_enrollment(
    device_uuid: Uuid,
    device_id: &str,
    code: &str,
    state: &AppState,
    tx: &tokio::sync::mpsc::Sender<String>,
    ws_rx: &mut futures_util::stream::SplitStream<WebSocket>,
) -> bool {
    // Subscribe to enrollment decision via Redis pub/sub
    let redis_url = state.config.redis.url.clone();
    let (decision_tx, mut decision_rx) = tokio::sync::mpsc::channel::<String>(4);

    tokio::spawn(async move {
        subscribe_enrollment(redis_url, device_uuid, decision_tx).await;
    });

    let mut ping_interval = interval(Duration::from_secs(30));
    // Re-send the code every 15s in case the device reconnects mid-wait
    let mut code_interval = interval(Duration::from_secs(15));
    let code = code.to_string();
    let dev_id = device_id.to_string();

    info!(device_id = %dev_id, code = %code, "waiting for admin enrollment approval");

    loop {
        tokio::select! {
            // Admin made a decision via Redis
            decision = decision_rx.recv() => {
                match decision.as_deref() {
                    Some("approved") => {
                        info!(device_id = %dev_id, "enrollment approved");
                        let _ = tx.send(json!({ "msg_type": "enrollment_approved" }).to_string()).await;
                        return true;
                    }
                    Some("rejected") => {
                        info!(device_id = %dev_id, "enrollment rejected");
                        let _ = tx.send(json!({ "msg_type": "enrollment_rejected" }).to_string()).await;
                        return false;
                    }
                    _ => return false,
                }
            }

            // Periodic ping to keep connection alive
            _ = ping_interval.tick() => {
                if tx.send("__ping__".to_string()).await.is_err() {
                    return false;
                }
            }

            // Re-send code periodically (device may have missed it)
            _ = code_interval.tick() => {
                let _ = tx.send(json!({
                    "msg_type": "enrollment_pending",
                    "code": code,
                    "device_uuid": device_uuid,
                }).to_string()).await;
            }

            // Device message (ignore telemetry during enrollment, detect disconnect)
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        info!(device_id = %dev_id, "device disconnected during enrollment");
                        return false;
                    }
                    Some(Err(_)) => return false,
                    _ => {}
                }
            }
        }
    }
}

async fn subscribe_enrollment(
    redis_url: String,
    device_id: Uuid,
    tx: tokio::sync::mpsc::Sender<String>,
) {
    let client = match redis::Client::open(redis_url) {
        Ok(c) => c,
        Err(e) => {
            error!("failed to open Redis client for enrollment sub: {e}");
            return;
        }
    };
    let mut pubsub = match client.get_async_pubsub().await {
        Ok(p) => p,
        Err(e) => {
            error!("failed to get pubsub: {e}");
            return;
        }
    };
    let channel = format!("enrollment:{device_id}");
    if let Err(e) = pubsub.subscribe(&channel).await {
        error!("failed to subscribe to {channel}: {e}");
        return;
    }

    let mut stream = pubsub.on_message();
    if let Some(msg) = stream.next().await {
        if let Ok(payload) = msg.get_payload::<String>() {
            let _ = tx.send(payload).await;
        }
    }
}

async fn run_main_loop(
    device: Device,
    state: AppState,
    tx: tokio::sync::mpsc::Sender<String>,
    mut ws_rx: futures_util::stream::SplitStream<WebSocket>,
) {
    // Generate JWT and send register_response
    let token = match generate_device_token(
        device.id,
        &device.device_id,
        &state.config.auth.jwt_secret,
        state.config.auth.device_token_ttl,
    ) {
        Ok(t) => t,
        Err(e) => {
            error!("failed to generate device token: {e}");
            return;
        }
    };

    let response = json!({
        "msg_type": "register_response",
        "device_id": device.device_id,
        "auth_token": token,
    });
    if tx.send(response.to_string()).await.is_err() {
        return;
    }

    // Register in WS registry
    state.ws_registry.insert(device.id, tx.clone()).await;

    // Subscribe to command channel via Redis
    let redis_url = state.config.redis.url.clone();
    let device_id_for_cmd = device.id;
    let tx_for_cmd = tx.clone();
    tokio::spawn(async move {
        subscribe_commands(redis_url, device_id_for_cmd, tx_for_cmd).await;
    });

    // Setup intervals
    let mut ping_interval = interval(Duration::from_secs(30));
    let token_refresh_secs = state.config.auth.device_token_ttl.saturating_sub(120);
    let mut token_refresh = interval(Duration::from_secs(token_refresh_secs.max(60)));
    let mut telemetry_counter: u32 = 0;
    let mut telemetry_received: u32 = 0;
    let db_sample_rate = state.config.telemetry.db_sample_rate;

    // Main message loop
    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        telemetry_received += 1;
                        if telemetry_received == 1 {
                            info!(device_id = %device.device_id, bytes = text.len(), "first telemetry message received from device");
                        } else {
                            debug!(device_id = %device.device_id, bytes = text.len(), n = telemetry_received, "telemetry message received");
                        }
                        handle_telemetry_msg(&text, &device, &state, &mut telemetry_counter, db_sample_rate).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!(device_id = %device.device_id, "device disconnected");
                        break;
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Err(e)) => {
                        warn!(device_id = %device.device_id, error = %e, "WebSocket error");
                        break;
                    }
                    _ => {}
                }
            }
            _ = ping_interval.tick() => {
                if tx.send("__ping__".to_string()).await.is_err() {
                    break;
                }
            }
            _ = token_refresh.tick() => {
                if let Ok(new_token) = generate_device_token(
                    device.id,
                    &device.device_id,
                    &state.config.auth.jwt_secret,
                    state.config.auth.device_token_ttl,
                ) {
                    let msg = json!({
                        "msg_type": "register_response",
                        "device_id": device.device_id,
                        "auth_token": new_token,
                    });
                    if tx.send(msg.to_string()).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    // Cleanup on disconnect
    state.ws_registry.remove(device.id).await;
    if let Err(e) = Device::set_status(device.id, "offline", &state.db).await {
        error!("failed to set device offline: {e}");
    }
    let _ = AuditLog::log_device_event(&state.db, device.id, "device.disconnect", None).await;
}

async fn handle_telemetry_msg(
    text: &str,
    device: &Device,
    state: &AppState,
    counter: &mut u32,
    db_sample_rate: u32,
) {
    let report: TelemetryReport = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            // Truncate raw payload in log to avoid flooding — first 300 chars is enough to diagnose.
            let snippet = &text[..text.len().min(300)];
            warn!(
                device_id = %device.device_id,
                error = %e,
                raw_snippet = %snippet,
                "telemetry parse error — message dropped, Redis NOT updated"
            );
            return;
        }
    };

    tracing::debug!(
        device_id = %device.device_id,
        state     = %report.state,
        paths     = report.paths.len(),
        "telemetry received, updating Redis cache"
    );

    // Update Redis live cache
    let redis_key = format!("telemetry:{}", device.id);
    let mut redis_conn = state.redis.clone();
    let result: std::result::Result<(), redis::RedisError> = redis::cmd("SET")
        .arg(&redis_key)
        .arg(text)
        .arg("EX")
        .arg(30u64)
        .query_async(&mut redis_conn)
        .await;

    if let Err(e) = result {
        warn!(
            device_id = %device.device_id,
            key       = %redis_key,
            error     = %e,
            "failed to write telemetry to Redis — live view will show stale data"
        );
    }

    // Update device last_state
    if let Err(e) = Device::update_telemetry_state(device.id, &report.state, &state.db).await {
        warn!(device_id = %device.device_id, error = %e, "failed to update device state in DB");
    }

    // Periodically persist to DB
    *counter += 1;
    if *counter >= db_sample_rate {
        *counter = 0;
        if let Err(e) = TelemetryRecord::insert(device.id, &report, &state.db).await {
            warn!(device_id = %device.device_id, error = %e, "failed to persist telemetry record to DB");
        }
    }
}

async fn subscribe_commands(redis_url: String, device_id: Uuid, tx: tokio::sync::mpsc::Sender<String>) {
    let client = match redis::Client::open(redis_url) {
        Ok(c) => c,
        Err(e) => {
            error!("failed to open Redis client for command subscription: {e}");
            return;
        }
    };
    let mut pubsub = match client.get_async_pubsub().await {
        Ok(p) => p,
        Err(e) => {
            error!("failed to get pubsub connection: {e}");
            return;
        }
    };
    let channel = format!("commands:{device_id}");
    if let Err(e) = pubsub.subscribe(&channel).await {
        error!("failed to subscribe to {channel}: {e}");
        return;
    }

    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        if let Ok(payload) = msg.get_payload::<String>() {
            if tx.send(payload).await.is_err() {
                break;
            }
        }
    }
}
