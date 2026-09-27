use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use webp::{Encoder, WebPConfig};

use super::{create, CaptureBackend, CaptureOptions, Damage, ScreenInfo};
use crate::net::sink::{ChannelSink, Rect};
use crate::net::state::NetState;

const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// The smallest resolution scale of the screen a viewer may ask for.
const MIN_SCALE: f32 = 0.05;

/// Capture options to the screen collector.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StreamOptions {
    #[serde(flatten)]
    pub capture: CaptureOptions,
    /// Resolution scale of the screen to deliver.
    pub resolution_scale: Option<f32>,
}

/// Where frames go out at, and how much of the screen they keep.
#[derive(Debug, Clone, Copy)]
struct Output {
    factor: f32,
    width: u16,
    height: u16,
}

impl Output {
    /// The shape frames take for `scale` on this screen.
    fn of(info: ScreenInfo, scale: Option<f32>) -> Self {
        let factor = match scale {
            Some(f) if f.is_finite() && f > 0.0 => f.clamp(MIN_SCALE, 1.0),
            _ => 1.0,
        };
        let size = |n: u16| ((n as f32 * factor).round() as u16).max(1);
        Self {
            factor,
            width: size(info.width),
            height: size(info.height),
        }
    }

    /// Whether frames have to be announced again.
    fn same_shape(&self, other: &Self) -> bool {
        (self.width, self.height) == (other.width, other.height)
    }
}

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
    pending: std::sync::Mutex<Option<StreamOptions>>,
}

/// Start pumping the screen onto channel `(token, channel_id)`.
#[tauri::command]
pub async fn start_screen_stream(
    net: State<'_, Arc<NetState>>,
    state: State<'_, StreamState>,
    token: String,
    channel_id: u64,
    options: Option<StreamOptions>,
) -> Result<StreamStarted, String> {
    let sink = ChannelSink::new(net.inner(), &token, channel_id)?;
    let mut backend = create().map_err(|e| e.to_string())?;

    if let Some(options) = &options {
        backend.configure(&options.capture);
    }

    let info = backend.info();
    let out = Output::of(info, options.and_then(|o| o.resolution_scale));

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let handle = Arc::new(StreamHandle {
        running: AtomicBool::new(true),
        pending: std::sync::Mutex::new(None),
    });
    state.streams.lock().unwrap().insert(id, handle.clone());

    tauri::async_runtime::spawn(run_stream(backend, sink, handle, out));
    Ok(StreamStarted {
        id,
        width: out.width,
        height: out.height,
        format: info.format.to_string(),
    })
}

/// Change how a running stream captures. Safe to call for an id that stopped.
#[tauri::command]
pub fn stream_configure(
    state: State<'_, StreamState>,
    id: u64,
    options: StreamOptions,
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
    start: Output,
) {
    let mut out = start;
    if !announce(&sink, backend.info(), out).await {
        return;
    }
    while handle.running.load(Ordering::Relaxed) {
        // Apply any options asked for since the last turn.
        let pending = handle.pending.lock().unwrap().take();
        if let Some(options) = pending {
            backend.configure(&options.capture);
            let next = Output::of(backend.info(), options.resolution_scale);
            if !out.same_shape(&next) {
                out = next;
                // The viewer is about to clear its canvas for the new shape, and
                // a diff would leave the untouched parts of it blank.
                backend.resync();
                if !announce(&sink, backend.info(), out).await {
                    return;
                }
            }
        }

        if let Ok(Some(image)) = backend.cursor_image() {
            if sink.cursor(&image).await.is_err() {
                return;
            }
        }

        if sink.congested().await {
            tokio::time::sleep(POLL_INTERVAL).await;
            continue;
        }

        // poll the backend
        let batch = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| backend.poll()));
        let rects = match batch {
            Ok(Ok(Some(rects))) => rects,
            Ok(Ok(None)) => {
                tokio::time::sleep(POLL_INTERVAL).await;
                continue;
            }
            Ok(Err(_)) | Err(_) => return,
        };

        // render the rects
        let mut blocks: Vec<(Rect, Vec<u8>)> = Vec::new();
        for (d, px) in &rects {
            if d.width == 0 || d.height == 0 {
                continue;
            }

            let shaped;
            let (d, px) = if out.factor < 1.0 {
                shaped = resample(*d, px, out);
                (&shaped.0, shaped.1.as_slice())
            } else {
                (d, px.as_slice())
            };

            // encode
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

        // group the blocks
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

/// Tell the peer what it is about to receive.
///
/// `false` means the channel is gone.
async fn announce(sink: &ChannelSink, info: ScreenInfo, out: Output) -> bool {
    sink.announce(out.width, out.height, (info.width, info.height))
        .await
        .is_ok()
}

/// The source pixels output pixel `o` covers along one axis, `(first, end)`.
fn span(o: usize, factor: f32, lo: usize, hi: usize) -> (usize, usize) {
    let from = ((o as f32) / factor).floor() as usize;
    let to = (((o + 1) as f32) / factor).ceil() as usize;
    let from = from.max(lo);
    (from, to.min(hi).max(from + 1))
}

/// Downscale a damage rectangle, averaging each output pixel over the source
/// pixels it covers.
fn resample(rect: Damage, px: &[u8], out: Output) -> (Damage, Vec<u8>) {
    let factor = out.factor;
    let x0 = ((rect.x as f32 * factor).floor() as u16).min(out.width - 1);
    let y0 = ((rect.y as f32 * factor).floor() as u16).min(out.height - 1);
    let x1 =
        (((rect.x as f32 + rect.width as f32) * factor).ceil() as u16).clamp(x0 + 1, out.width);
    let y1 =
        (((rect.y as f32 + rect.height as f32) * factor).ceil() as u16).clamp(y0 + 1, out.height);
    let (w, h) = ((x1 - x0) as usize, (y1 - y0) as usize);
    let (left, right) = (rect.x as usize, rect.x as usize + rect.width as usize);
    let (top, bottom) = (rect.y as usize, rect.y as usize + rect.height as usize);
    let mut dst = vec![0u8; w * h * 4];

    // iterate over the spanned rows
    for oy in 0..h {
        let (sy0, sy1) = span(y0 as usize + oy, factor, top, bottom);
        for ox in 0..w {
            let (sx0, sx1) = span(x0 as usize + ox, factor, left, right);
            let mut acc = [0u32; 4];
            for sy in sy0..sy1 {
                for sx in sx0..sx1 {
                    let o = ((sy - top) * rect.width as usize + sx - left) * 4;
                    for c in 0..4 {
                        acc[c] += px[o + c] as u32;
                    }
                }
            }
            let n = ((sy1 - sy0) * (sx1 - sx0)) as u32;
            let o = (oy * w + ox) * 4;
            for c in 0..4 {
                dst[o + c] = (acc[c] / n) as u8;
            }
        }
    }
    (
        Damage {
            x: x0,
            y: y0,
            width: w as u16,
            height: h as u16,
        },
        dst,
    )
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
    config.quality = 70.0;
    Encoder::from_rgb(&rgb, bw as u32, bh as u32)
        .encode_advanced(&config)
        .ok()
        .map(|mem| mem.to_vec())
}
