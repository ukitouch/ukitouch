//! Generic byte pipe: bridges a local TCP socket to a P2P DataChannel.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use crate::net::state::NetState;

/// A text message kind payload byte in the pipe header.
const KIND_TEXT: u8 = 1;

#[derive(Default)]
pub struct PipeState {
    pipes: std::sync::Mutex<HashMap<u64, CancellationToken>>,
    next_id: std::sync::atomic::AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipeHandle {
    pub id: u64,
}

#[tauri::command]
pub async fn pipe_bind(
    net: State<'_, Arc<NetState>>,
    state: State<'_, PipeState>,
    token: String,
    channel_id: u64,
    addr: String,
) -> Result<PipeHandle, String> {
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("connect to {addr}: {e}"))?;

    let id = state
        .next_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let cancel = CancellationToken::new();

    let task_cancel = cancel.clone();
    tauri::async_runtime::spawn(pipe_pump(
        stream,
        Arc::clone(net.inner()),
        token,
        channel_id,
        task_cancel,
    ));

    state.pipes.lock().unwrap().insert(id, cancel);

    Ok(PipeHandle { id })
}

/// Pump the same pipe into a frontend `Channel`.
#[tauri::command]
pub async fn pipe_channel(
    state: State<'_, PipeState>,
    on_event: Channel<InvokeResponseBody>,
    addr: String,
) -> Result<PipeHandle, String> {
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("connect to {addr}: {e}"))?;

    let id = state
        .next_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let cancel = CancellationToken::new();

    let task_cancel = cancel.clone();
    tauri::async_runtime::spawn(pipe_events(stream, on_event, task_cancel));

    state.pipes.lock().unwrap().insert(id, cancel);

    Ok(PipeHandle { id })
}

#[tauri::command]
pub fn pipe_unbind(state: State<'_, PipeState>, id: u64) -> Result<(), String> {
    if let Some(token) = state.pipes.lock().unwrap().remove(&id) {
        token.cancel();
    }
    Ok(())
}

/// Read one length-prefixed message: `(is_text, payload)`.
///
/// `None` means the peer closed cleanly or the framing broke.
async fn read_message(stream: &mut TcpStream) -> Option<(bool, Vec<u8>)> {
    // Read 4-byte length prefix and the kind byte.
    let mut head = [0u8; 5];
    match stream.read_exact(&mut head).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return None,
        Err(e) => {
            eprintln!("[pipe] read header error: {e}");
            return None;
        }
    }

    let len = u32::from_le_bytes(head[..4].try_into().unwrap()) as usize;
    const MAX_MSG: usize = 50 * 1024 * 1024; // 50 MiB
    if len > MAX_MSG {
        eprintln!("[pipe] message too large: {len}");
        return None;
    }

    // Read exactly one application message.
    let mut payload = vec![0u8; len];
    if let Err(e) = stream.read_exact(&mut payload).await {
        eprintln!("[pipe] read payload error: {e}");
        return None;
    }

    Some((head[4] == KIND_TEXT, payload))
}

async fn pipe_pump(
    mut stream: TcpStream,
    net: Arc<NetState>,
    token: String,
    channel_id: u64,
    cancel: CancellationToken,
) {
    while !cancel.is_cancelled() {
        let Some((text, payload)) = read_message(&mut stream).await else {
            break;
        };

        // Forward as a single WebRTC DataChannel message.
        if let Err(e) = net.send_bytes(&token, channel_id, payload, text).await {
            eprintln!("[pipe] send error: {e}");
            break;
        }
    }

    eprintln!("[pipe] ended for {token}/{channel_id}");
}

async fn pipe_events(
    mut stream: TcpStream,
    on_event: Channel<InvokeResponseBody>,
    cancel: CancellationToken,
) {
    while !cancel.is_cancelled() {
        let Some((text, payload)) = read_message(&mut stream).await else {
            break;
        };

        let body = if text {
            match String::from_utf8(payload) {
                Ok(json) => InvokeResponseBody::Json(json),
                Err(_) => break,
            }
        } else {
            InvokeResponseBody::Raw(payload)
        };
        if on_event.send(body).is_err() {
            break;
        }
    }
}
