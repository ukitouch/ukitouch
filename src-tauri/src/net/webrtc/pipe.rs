//! Bridges a local TCP socket to a WebRTC DataChannel.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use crate::net::state::NetState;
use crate::net::webrtc::channel::{send as webrtc_send, MAX_MESSAGE};

/// A text message kind payload byte in the pipe header.
const KIND_TEXT: u8 = 1;
/// Max payload bytes a single frame may carry.
/// 
/// A frame must be sendable as one DataChannel message, see [`MAX_MESSAGE`].
const MAX_MSG: usize = MAX_MESSAGE;

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

#[tauri::command]
pub fn pipe_unbind(state: State<'_, PipeState>, id: u64) -> Result<(), String> {
    if let Some(token) = state.pipes.lock().unwrap().remove(&id) {
        token.cancel();
    }
    Ok(())
}

/// `(is_text, payload)`
///
/// Return `None` means the peer closed cleanly or the framing broke.
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
        if let Err(e) = webrtc_send(&net, token.clone(), channel_id, payload, text).await {
            eprintln!("[pipe] send error: {e}");
            break;
        }
    }

    eprintln!("[pipe] ended for {token}/{channel_id}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    /// One wire frame.
    fn frame(kind: u8, payload: &[u8]) -> Vec<u8> {
        let mut v = (payload.len() as u32).to_le_bytes().to_vec();
        v.push(kind);
        v.extend_from_slice(payload);
        v
    }

    /// A loopback stream whose peer writes `chunks` in order, then closes.
    async fn loopback_stream(chunks: Vec<Vec<u8>>) -> TcpStream {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(addr).await.unwrap();
        let server = listener.accept().await.unwrap().0;
        tokio::spawn(async move {
            for chunk in &chunks {
                client.write_all(chunk).await.unwrap();
            }
            client.shutdown().await.unwrap();
        });
        server
    }

    #[tokio::test]
    async fn reads_binary_and_text_frames() {
        let mut s = loopback_stream(vec![frame(0, b"hello"), frame(1, b"hi")]).await;

        let (text, data) = read_message(&mut s).await.unwrap();
        assert!(!text);
        assert_eq!(data, b"hello");

        let (text, data) = read_message(&mut s).await.unwrap();
        assert!(text);
        assert_eq!(data, b"hi");

        // peer closed cleanly
        assert!(read_message(&mut s).await.is_none());
    }

    #[tokio::test]
    async fn truncated_payload_ends_stream() {
        // header promises 10 bytes, only 4 arrive, then close
        let mut partial = frame(0, b"1234567890");
        partial.truncate(9);
        let mut s = loopback_stream(vec![partial]).await;
        assert!(read_message(&mut s).await.is_none());
    }

    #[tokio::test]
    async fn max_size_boundary() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(addr).await.unwrap();
        let mut server = listener.accept().await.unwrap().0;
        let mut header = (MAX_MSG as u32 + 1).to_le_bytes().to_vec();
        header.push(0); // kind byte
        client.write_all(&header).await.unwrap();
        let r = tokio::time::timeout(Duration::from_secs(2), read_message(&mut server)).await;
        assert!(r.is_ok_and(|m| m.is_none()));
        drop(client);

        // exactly MAX_MSG is accepted
        let payload = vec![0u8; MAX_MSG];
        let mut s = loopback_stream(vec![frame(1, &payload)]).await;
        let (text, data) = read_message(&mut s).await.unwrap();
        assert!(text);
        assert_eq!(data.len(), MAX_MSG);
    }
}
