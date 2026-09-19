use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use webp::{Encoder, WebPConfig};

use super::{create, CaptureBackend, CaptureOptions, Damage};
use crate::net::sink::{ChannelSink, Rect};
use crate::net::state::NetState;

/// Poll cadence: an idle screen costs one cheap check per tick.
const POLL_INTERVAL: Duration = Duration::from_millis(16);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStarted {
    pub id: u64,
    pub width: u16,
    pub height: u16,
    pub format: String,
}

#[derive(Default)]
pub struct StreamState {
    streams: std::sync::Mutex<std::collections::HashMap<u64, Arc<StreamHandle>>>,
    next_id: std::sync::atomic::AtomicU64,
}

struct StreamHandle {
    running: AtomicBool,
    /// Options from a `stream_configure`, taken by the task on its next turn.
    pending: std::sync::Mutex<Option<CaptureOptions>>,
}

/// Start pumping the screen onto channel `(token, channel_id)`.
#[tauri::command]
pub async fn start_screen_stream(
    net: State<'_, Arc<NetState>>,
    state: State<'_, StreamState>,
    token: String,
    channel_id: u64,
    options: Option<CaptureOptions>,
) -> Result<StreamStarted, String> {
    let sink = ChannelSink::new(net.inner(), &token, channel_id)?;
    let mut backend = create().map_err(|e| e.to_string())?;
    if let Some(options) = &options {
        backend.configure(options);
    }
    let info = backend.info();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let handle = Arc::new(StreamHandle {
        running: AtomicBool::new(true),
        pending: std::sync::Mutex::new(None),
    });
    state.streams.lock().unwrap().insert(id, handle.clone());

    tauri::async_runtime::spawn(run_stream(backend, sink, handle));
    Ok(StreamStarted {
        id,
        width: info.width,
        height: info.height,
        format: info.format.to_string(),
    })
}

/// Change how a running stream captures. Safe to call for an id that stopped.
#[tauri::command]
pub fn stream_configure(
    state: State<'_, StreamState>,
    id: u64,
    options: CaptureOptions,
) -> Result<(), String> {
    if let Some(handle) = state.streams.lock().unwrap().get(&id) {
        *handle.pending.lock().unwrap() = Some(options);
    }
    Ok(())
}

/// Stop a running stream. Safe to call for an id that already stopped.
#[tauri::command]
pub fn stop_screen_stream(state: State<'_, StreamState>, id: u64) -> Result<(), String> {
    if let Some(handle) = state.streams.lock().unwrap().remove(&id) {
        handle.running.store(false, Ordering::Relaxed);
    }
    Ok(())
}

/// Poll the source and ship each batch, shedding load at the poll boundary.
async fn run_stream(
    mut backend: Box<dyn CaptureBackend>,
    sink: ChannelSink,
    handle: Arc<StreamHandle>,
) {
    let mut info = backend.info();
    if sink.announce(info.width, info.height).await.is_err() {
        return;
    }
    while handle.running.load(Ordering::Relaxed) {
        // Apply any options asked for since the last turn. A new shape has to be
        // announced before the rectangles that follow it.
        let pending = handle.pending.lock().unwrap().take();
        if let Some(options) = pending {
            if backend.configure(&options) {
                info = backend.info();
                if sink.announce(info.width, info.height).await.is_err() {
                    return;
                }
            }
        }

        if sink.congested().await {
            tokio::time::sleep(POLL_INTERVAL).await;
            continue;
        }

        let batch = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| backend.poll()));
        let rects = match batch {
            Ok(Ok(Some(rects))) => rects,
            Ok(Ok(None)) => {
                tokio::time::sleep(POLL_INTERVAL).await;
                continue;
            }
            Ok(Err(_)) | Err(_) => return,
        };

        let mut blocks: Vec<(Rect, Vec<u8>)> = Vec::new();
        for (d, px) in &rects {
            if d.width == 0 || d.height == 0 {
                continue;
            }
            if let Some(payload) = encode_webp(d, px) {
                blocks.push((
                    Rect {
                        x: d.x,
                        y: d.y,
                        width: d.width,
                        height: d.height,
                    },
                    payload,
                ));
            }
        }
        let frame: Vec<(Rect, &[u8])> = blocks
            .iter()
            .map(|(rect, payload)| (*rect, payload.as_slice()))
            .collect();
        if sink.push(&frame).await.is_err() {
            return;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// WebP-encode a damage rectangle, or `None` if the encoder fails.
///
/// Lossy WebP is always 4:2:0.
fn encode_webp(src: &Damage, px: &[u8]) -> Option<Vec<u8>> {
    let bw = src.width as usize;
    let bh = src.height as usize;
    let mut rgb = Vec::with_capacity(bw * bh * 3);
    for y in 0..bh {
        let row = y * bw * 4;
        for x in 0..bw {
            let o = row + x * 4;
            rgb.extend_from_slice(&px[o..o + 3]);
        }
    }
    let mut config = WebPConfig::new().ok()?;
    config.lossless = 0;
    config.quality = 80.0;
    config.method = 0;
    Encoder::from_rgb(&rgb, bw as u32, bh as u32)
        .encode_advanced(&config)
        .ok()
        .map(|mem| mem.to_vec())
}
