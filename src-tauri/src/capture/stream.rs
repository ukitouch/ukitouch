use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use super::{create, CaptureBackend};
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
}

/// Start pumping the screen onto channel `(token, channel_id)`.
#[tauri::command]
pub async fn start_screen_stream(
    net: State<'_, Arc<NetState>>,
    state: State<'_, StreamState>,
    token: String,
    channel_id: u64,
) -> Result<StreamStarted, String> {
    let sink = ChannelSink::new(net.inner(), &token, channel_id)?;
    let backend = create().map_err(|e| e.to_string())?;
    let info = backend.info();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let handle = Arc::new(StreamHandle {
        running: AtomicBool::new(true),
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
    let info = backend.info();
    if sink.announce(info.width, info.height).await.is_err() {
        return;
    }
    while handle.running.load(Ordering::Relaxed) {
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

        let frame: Vec<(Rect, &[u8])> = rects
            .iter()
            .map(|(d, px)| {
                (
                    Rect {
                        x: d.x,
                        y: d.y,
                        width: d.width,
                        height: d.height,
                    },
                    px.as_slice(),
                )
            })
            .collect();
        if sink.push(&frame).await.is_err() {
            return;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}
