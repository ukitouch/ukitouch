//! Exposes screen capture to the frontend.
//!
//! Capture runs as a task: the frontend starts a monitor, gets a handle back,
//! and receives changed rectangles on a `Channel` until it stops.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::{create, CaptureBackend, CaptureOptions, Damage, Started, POLL_INTERVAL};

/// The backend, kept alive across command calls.
#[derive(Default)]
pub struct CaptureState {
    monitors: std::sync::Mutex<std::collections::HashMap<u64, Arc<MonitorHandle>>>,
    next_id: std::sync::atomic::AtomicU64,
}

/// One rectangle's place in a frame's pixel blob.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RectSpan {
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    /// byte offset of this rectangle's pixels in the blob that follows
    offset: usize,
    /// byte length
    len: usize,
}

/// Events a monitor reports.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MonitorEvent {
    /// one frame's rectangles
    Frame { rects: Vec<RectSpan>, total: usize },
    /// capture stopped, `reason` is absent for a normal stop
    Stopped {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

/// Shared control flags for one running monitor.
#[derive(Default)]
struct MonitorHandle {
    running: AtomicBool,
    /// set to ask the task for a full frame
    resync: AtomicBool,
    /// capture options, taken by the task on its next turn
    pending: std::sync::Mutex<Option<CaptureOptions>>,
}

/// Start capturing. Returns the monitor id and the screen's shape.
#[tauri::command]
pub async fn capture_start(
    state: State<'_, CaptureState>,
    on_event: Channel<InvokeResponseBody>,
    options: Option<CaptureOptions>,
) -> Result<Started, String> {
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
    Ok(Started {
        id,
        width: info.width,
        height: info.height,
        format: info.format.to_string(),
    })
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
            // gather the whole frame
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
                    let _ = send_json(
                        &on_event,
                        &MonitorEvent::Stopped {
                            reason: Some(format!("channel closed: {e}")),
                        },
                    );
                    return;
                }

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

/// Run one poll.
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

/// Ask a monitor for the whole screen again.
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

/// Send a JSON message on the channel.
fn send_json<T: Serialize>(ch: &Channel<InvokeResponseBody>, msg: &T) -> Result<(), String> {
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    ch.send(InvokeResponseBody::Json(json))
        .map_err(|e| e.to_string())
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
