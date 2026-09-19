//! Exposes screen capture to the frontend.
//!
//! Capture runs as a task: the frontend starts a monitor, gets a handle back,
//! and receives changed rectangles on a `Channel` until it stops. The task owns
//! the backend.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::{create, CaptureBackend, CaptureOptions, Damage};

/// How often to ask the backend for changes.
///
/// This is a poll interval, not a frame rate: an idle screen costs one cheap
/// check per tick and produces nothing. 16ms keeps the worst case at roughly
/// 60fps without pretending we can guarantee it.
const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// One rectangle's place in a frame's pixel blob.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RectSpan {
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    /// Byte offset of this rectangle's pixels in the blob that follows.
    offset: usize,
    /// Byte length, so a caller can tell a truncated blob from a complete one.
    len: usize,
}

/// What a monitor reports.
///
/// Pixels never appear here. A frame's rectangles are described in one JSON
/// message and all of their pixels follow in one raw message. A message per
/// rectangle turns a full-screen repaint into hundreds of round trips, which
/// is the difference between a fast frame and a slow one.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MonitorEvent {
    /// One frame's rectangles, whose concatenated pixels follow as raw bytes.
    Frame { rects: Vec<RectSpan>, total: usize },
    /// Capture stopped. `reason` is absent for a normal stop.
    Stopped {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

/// What {@link capture_start} returns.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorStarted {
    pub id: u64,
    pub width: u16,
    pub height: u16,
    pub format: String,
}

/// Live monitors, a stop command can reach the right task.
#[derive(Default)]
pub struct CaptureState {
    monitors: std::sync::Mutex<std::collections::HashMap<u64, Arc<MonitorHandle>>>,
    next_id: std::sync::atomic::AtomicU64,
}

/// Shared control flags for one running monitor.
#[derive(Default)]
struct MonitorHandle {
    /// Cleared to ask the task to stop.
    running: AtomicBool,
    /// Set to ask the task for a full frame.
    resync: AtomicBool,
    /// Options from a `capture_configure`, taken by the task on its next turn.
    pending: std::sync::Mutex<Option<CaptureOptions>>,
}

/// Start capturing. Returns the monitor id and the screen's shape.
#[tauri::command]
pub async fn capture_start(
    state: State<'_, CaptureState>,
    on_event: Channel<InvokeResponseBody>,
    options: Option<CaptureOptions>,
) -> Result<MonitorStarted, String> {
    // The backend is opened here so a failure — no display, no extension, a
    // refusal — reaches the caller as a rejection instead of a dead monitor.
    let mut backend = create().map_err(|e| e.to_string())?;
    if let Some(options) = &options {
        backend.configure(options);
    }
    let info = backend.info();

    let id = state
        .next_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let handle = Arc::new(MonitorHandle {
        running: AtomicBool::new(true),
        resync: AtomicBool::new(false),
        pending: std::sync::Mutex::new(None),
    });
    state.monitors.lock().unwrap().insert(id, handle.clone());

    tauri::async_runtime::spawn(run_monitor(backend, on_event, handle));
    Ok(MonitorStarted {
        id,
        width: info.width,
        height: info.height,
        format: info.format.to_string(),
    })
}

/// Send a JSON message on the channel.
fn send_json<T: Serialize>(ch: &Channel<InvokeResponseBody>, msg: &T) -> Result<(), String> {
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    ch.send(InvokeResponseBody::Json(json))
        .map_err(|e| e.to_string())
}

/// Pump the backend until stopped, forwarding each batch to the frontend.
async fn run_monitor(
    mut backend: Box<dyn CaptureBackend>,
    on_event: Channel<InvokeResponseBody>,
    handle: Arc<MonitorHandle>,
) {
    while handle.running.load(Ordering::Relaxed) {
        // Apply any options asked for since the last turn.
        if let Some(options) = handle.pending.lock().unwrap().take() {
            backend.configure(&options);
        }

        // Take a pending resync request before polling.
        if handle.resync.swap(false, Ordering::Relaxed) {
            backend.resync();
        }

        // Catch a backend panic and report a stop like any other failure.
        let batch = match poll_once(&mut backend) {
            Ok(b) => b,
            Err(reason) => {
                let _ = send_json(
                    &on_event,
                    &MonitorEvent::Stopped {
                        reason: Some(reason),
                    },
                );
                return;
            }
        };

        if let Some(rects) = batch {
            // Gather the whole frame: one header describing every rectangle, and
            // one blob holding all of their pixels back to back.
            let mut spans = Vec::with_capacity(rects.len());
            let mut blob = Vec::new();
            for (d, px) in rects {
                if !handle.running.load(Ordering::Relaxed) {
                    break;
                }
                spans.push(RectSpan {
                    x: d.x,
                    y: d.y,
                    width: d.width,
                    height: d.height,
                    offset: blob.len(),
                    len: px.len(),
                });
                blob.extend_from_slice(&px);
            }

            if !spans.is_empty() {
                let total = blob.len();
                let header = MonitorEvent::Frame {
                    rects: spans,
                    total,
                };
                if let Err(e) = send_json(&on_event, &header) {
                    // Losing the channel is not the same as a stop request, so say
                    // so rather than exiting quietly.
                    let _ = send_json(
                        &on_event,
                        &MonitorEvent::Stopped {
                            reason: Some(format!("channel closed: {e}")),
                        },
                    );
                    return;
                }
                // Raw to takes the channel's fetch path.
                if let Err(e) = on_event.send(InvokeResponseBody::Raw(blob)) {
                    let _ = send_json(
                        &on_event,
                        &MonitorEvent::Stopped {
                            reason: Some(format!("pixel send failed: {e}")),
                        },
                    );
                    return;
                }
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    let _ = send_json(&on_event, &MonitorEvent::Stopped { reason: None });
}

/// Run one poll, turning both an error and a panic into a reason to stop.
///
/// A panicking backend would otherwise unwind out of the task and leave a
/// monitor that looks alive and never delivers again.
fn poll_once(
    backend: &mut Box<dyn CaptureBackend>,
) -> Result<Option<Vec<(Damage, Vec<u8>)>>, String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| backend.poll())) {
        Ok(Ok(batch)) => Ok(batch),
        Ok(Err(e)) => Err(e.to_string()),
        Err(panic) => Err(format!(
            "capture backend panicked: {}",
            panic_message(&*panic)
        )),
    }
}

/// Read the message out of a panic payload.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.as_str()
    } else {
        "unknown panic"
    }
}

/// Ask a monitor for the whole screen again.
///
/// Damage is incremental, so a viewer with no baseline — one that just
/// connected, or that dropped a frame — needs one full frame to resume from.
#[tauri::command]
pub fn capture_resync(state: State<'_, CaptureState>, id: u64) -> Result<(), String> {
    if let Some(handle) = state.monitors.lock().unwrap().get(&id) {
        handle.resync.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Change how a running monitor captures. Safe to call for an id that stopped.
#[tauri::command]
pub fn capture_configure(
    state: State<'_, CaptureState>,
    id: u64,
    options: CaptureOptions,
) -> Result<(), String> {
    if let Some(handle) = state.monitors.lock().unwrap().get(&id) {
        *handle.pending.lock().unwrap() = Some(options);
    }
    Ok(())
}

/// Stop a monitor. Safe to call for an id that already stopped.
#[tauri::command]
pub fn capture_stop(state: State<'_, CaptureState>, id: u64) -> Result<(), String> {
    if let Some(handle) = state.monitors.lock().unwrap().remove(&id) {
        handle.running.store(false, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{CaptureError, ScreenInfo};
    use super::*;

    /// A backend that panics, to prove the safety net actually catches it.
    struct Panicking;

    impl CaptureBackend for Panicking {
        fn info(&self) -> ScreenInfo {
            ScreenInfo {
                width: 1,
                height: 1,
                format: "rgba",
            }
        }
        fn poll(&mut self) -> Result<Option<Vec<(Damage, Vec<u8>)>>, CaptureError> {
            panic!("backend blew up");
        }
        fn resync(&mut self) {}
    }

    /// A panicking backend must surface as a stop reason, not unwind out of the
    /// task and leave the frontend waiting forever.
    #[test]
    fn a_panicking_backend_becomes_a_stop_reason() {
        let mut backend: Box<dyn CaptureBackend> = Box::new(Panicking);
        let err = poll_once(&mut backend).expect_err("should report rather than unwind");
        assert!(err.contains("panicked"), "unhelpful reason: {err}");
        assert!(err.contains("backend blew up"), "lost the message: {err}");
    }
}
