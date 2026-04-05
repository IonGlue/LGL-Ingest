//! RTMP listen source: accepts an incoming RTMP push and re-exposes
//! the video as SRT on the internal port.
//!
//! Uses rml_rtmp for RTMP handshake and protocol handling.
//! Receives FLV data and feeds it into a GStreamer pipeline
//! via appsrc → flvdemux → h264parse → mpegtsmux → srtsink.

use anyhow::{Context, Result};
use bytes::Bytes;
use gstreamer::prelude::*;
use log::{info, warn};
use rml_rtmp::handshake::{Handshake, HandshakeProcessResult, PeerType};
use rml_rtmp::sessions::{
    ServerSession, ServerSessionConfig, ServerSessionEvent, ServerSessionResult,
};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::RtmpListenConfig;

pub async fn run(id: String, internal_port: u16, config: RtmpListenConfig) -> Result<()> {
    let listen_port = config.port;
    let expected_key = config.stream_key.clone();

    info!("[{id}] rtmp_listen source: listening on :{listen_port} → re-exposing on SRT :{internal_port}");

    let output_uri = format!(
        "srt://0.0.0.0:{internal_port}?mode=listener&latency={}",
        config.latency_ms
    );

    let pipeline_str = format!(
        "appsrc name=src is-live=true format=3 ! \
         flvdemux name=demux ! \
         queue ! \
         h264parse ! \
         mpegtsmux ! \
         srtsink name=srt_out uri=\"{output_uri}\" wait-for-connection=false"
    );

    info!("[{id}] pipeline: {pipeline_str}");

    let pipeline = gstreamer::parse::launch(&pipeline_str)
        .context("failed to parse pipeline")?
        .downcast::<gstreamer::Pipeline>()
        .map_err(|_| anyhow::anyhow!("not a pipeline"))?;

    let appsrc = pipeline
        .by_name("src")
        .context("no appsrc element")?
        .downcast::<gstreamer_app::AppSrc>()
        .map_err(|_| anyhow::anyhow!("not an appsrc"))?;

    let bus = pipeline.bus().context("no bus")?;
    pipeline
        .set_state(gstreamer::State::Playing)
        .context("set Playing failed")?;
    info!("[{id}] rtmp_listen pipeline playing, waiting for RTMP connection");

    let appsrc = Arc::new(Mutex::new(appsrc));

    let listener = TcpListener::bind(format!("0.0.0.0:{listen_port}"))
        .await
        .context(format!("failed to bind RTMP port {listen_port}"))?;

    info!("[{id}] RTMP server listening on :{listen_port}");

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (mut stream, addr) = accept_result.context("accept failed")?;
                info!("[{id}] RTMP connection from {addr}");

                let mut handshake = Handshake::new(PeerType::Server);
                let mut buf = [0u8; 4096];

                let mut handshake_complete = false;
                while !handshake_complete {
                    let n = stream.read(&mut buf).await.context("read during handshake")?;
                    if n == 0 { anyhow::bail!("connection closed during handshake"); }

                    match handshake.process_bytes(&buf[..n])
                        .map_err(|e| anyhow::anyhow!("handshake error: {:?}", e))?
                    {
                        HandshakeProcessResult::InProgress { response_bytes } => {
                            stream.write_all(&response_bytes).await?;
                        }
                        HandshakeProcessResult::Completed { response_bytes, remaining_bytes: _ } => {
                            stream.write_all(&response_bytes).await?;
                            handshake_complete = true;
                        }
                    }
                }

                info!("[{id}] RTMP handshake complete");

                let session_config = ServerSessionConfig::new();
                let (mut session, initial_results) = ServerSession::new(session_config)
                    .map_err(|e| anyhow::anyhow!("session create error: {:?}", e))?;

                for result in initial_results {
                    if let ServerSessionResult::OutboundResponse(data) = result {
                        stream.write_all(&data.bytes).await?;
                    }
                }

                let mut stream_key_validated = false;
                let appsrc_clone = appsrc.clone();

                loop {
                    let n = match stream.read(&mut buf).await {
                        Ok(0) => { info!("[{id}] RTMP client disconnected"); break; }
                        Ok(n) => n,
                        Err(e) => { warn!("[{id}] RTMP read error: {e}"); break; }
                    };

                    let results = session.handle_input(&buf[..n])
                        .map_err(|e| anyhow::anyhow!("session error: {:?}", e))?;

                    for result in results {
                        match result {
                            ServerSessionResult::OutboundResponse(data) => {
                                stream.write_all(&data.bytes).await?;
                            }
                            ServerSessionResult::RaisedEvent(event) => {
                                match event {
                                    ServerSessionEvent::ConnectionRequested { request_id, .. } => {
                                        let accept_results = session.accept_request(request_id)
                                            .map_err(|e| anyhow::anyhow!("accept error: {:?}", e))?;
                                        for r in accept_results {
                                            if let ServerSessionResult::OutboundResponse(data) = r {
                                                stream.write_all(&data.bytes).await?;
                                            }
                                        }
                                    }
                                    ServerSessionEvent::PublishStreamRequested { request_id, app_name, stream_key, .. } => {
                                        info!("[{id}] publish request: app={app_name} key={stream_key}");
                                        if stream_key == expected_key || expected_key.is_empty() {
                                            stream_key_validated = true;
                                            let accept_results = session.accept_request(request_id)
                                                .map_err(|e| anyhow::anyhow!("accept error: {:?}", e))?;
                                            for r in accept_results {
                                                if let ServerSessionResult::OutboundResponse(data) = r {
                                                    stream.write_all(&data.bytes).await?;
                                                }
                                            }
                                            info!("[{id}] stream key validated, accepting publish");
                                        } else {
                                            warn!("[{id}] invalid stream key: {stream_key}");
                                            break;
                                        }
                                    }
                                    ServerSessionEvent::AudioDataReceived { data, .. } |
                                    ServerSessionEvent::VideoDataReceived { data, .. } => {
                                        if stream_key_validated {
                                            let bytes = Bytes::from(data);
                                            let buffer = gstreamer::Buffer::from_slice(bytes);
                                            let src: std::sync::MutexGuard<'_, gstreamer_app::AppSrc> = appsrc_clone.lock().unwrap();
                                            if let Err(e) = src.push_buffer(buffer) {
                                                warn!("[{id}] appsrc push error: {e}");
                                            }
                                        }
                                    }
                                    ServerSessionEvent::PublishStreamFinished { .. } => {
                                        info!("[{id}] publish stream finished");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                            ServerSessionResult::UnhandleableMessageReceived(_) => {}
                        }
                    }
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("[{id}] SIGINT — stopping");
                break;
            }
        }
    }

    drop(bus);
    pipeline.set_state(gstreamer::State::Null).ok();
    Ok(())
}
