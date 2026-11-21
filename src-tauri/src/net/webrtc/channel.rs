use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Emitter;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;

use super::peer::{self, Peer};
use crate::net::state::NetState;

/// The peer's data channel reader takes at most `u16::MAX` bytes per message.
const MAX_MESSAGE: usize = u16::MAX as usize;

/// Bytes held before the frontend binds.
const INBOUND_CAP: usize = 4 * 1024 * 1024;

/// A data channel with send buffering until it opens.
pub struct ChannelHandle {
    pub dc: Arc<RTCDataChannel>,
    pub open: std::sync::atomic::AtomicBool,
    /// Pending (bytes, text) sends queued before the channel opened.
    pub buffer: Mutex<Vec<(Vec<u8>, bool)>>,
    /// Signals when the channel transitions to open.
    pub opened: tokio::sync::Notify,
    /// Where inbound messages go.
    pub inbound: Mutex<Inbound>,
}

/// The frontend's end of a channel's inbound stream.
#[derive(Default)]
pub struct Inbound {
    sink: Option<Channel<InvokeResponseBody>>,
    buffered: Vec<(Vec<u8>, bool)>,
    bytes: usize,
}

impl ChannelHandle {
    pub fn new(dc: Arc<RTCDataChannel>) -> Self {
        Self {
            dc,
            open: std::sync::atomic::AtomicBool::new(false),
            buffer: Mutex::new(Vec::new()),
            opened: tokio::sync::Notify::new(),
            inbound: Mutex::new(Inbound::default()),
        }
    }
}

/// Point a channel at the frontend's sink and flush the backlog.
pub fn bind(
    state: &Arc<NetState>,
    token: &str,
    channel_id: u64,
    sink: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let peer = peer::find_by_token(state, token)?;
    let handle = peer
        .channels
        .lock()
        .unwrap()
        .get(&channel_id)
        .cloned()
        .ok_or("channel not found")?;

    let buffered = {
        let mut inbound = handle.inbound.lock().unwrap();
        inbound.sink = Some(sink.clone());
        inbound.bytes = 0;
        std::mem::take(&mut inbound.buffered)
    };
    for (data, text) in buffered {
        forward(&sink, &data, text);
    }
    Ok(())
}

/// Forward one message to the frontend.
fn forward(sink: &Channel<InvokeResponseBody>, data: &[u8], text: bool) {
    let body = match (text, std::str::from_utf8(data)) {
        (true, Ok(s)) => InvokeResponseBody::Json(serde_json::to_string(s).unwrap()),
        _ => InvokeResponseBody::Raw(data.to_vec()),
    };
    let _ = sink.send(body);
}

/// Forward one inbound message, or buffer it until [`bind`].
fn push_inbound(handle: &Arc<ChannelHandle>, data: &[u8], text: bool) {
    let sink = {
        let mut inbound = handle.inbound.lock().unwrap();
        match &inbound.sink {
            Some(sink) => Some(sink.clone()),
            None => {
                inbound.bytes += data.len();
                inbound.buffered.push((data.to_vec(), text));
                while inbound.bytes > INBOUND_CAP && !inbound.buffered.is_empty() {
                    let (old, _) = inbound.buffered.remove(0);
                    inbound.bytes -= old.len();
                }
                None
            }
        }
    };
    if let Some(sink) = sink {
        forward(&sink, data, text);
    }
}

/// Send bytes out on a channel. Buffers until the channel opens.
pub async fn send(
    state: &Arc<NetState>,
    token: String,
    channel_id: u64,
    data: Vec<u8>,
    text: bool,
) -> Result<(), String> {
    if data.len() > MAX_MESSAGE {
        return Err(format!("message too large: {} bytes", data.len()));
    }

    let peer = peer::find_by_token(state, &token)?;
    let handle = peer
        .channels
        .lock()
        .unwrap()
        .get(&channel_id)
        .cloned()
        .ok_or("channel not found")?;
    if !handle.open.load(Ordering::SeqCst) {
        handle.buffer.lock().unwrap().push((data, text));
        return Ok(());
    }
    send_now(&handle, data, text).await
}

async fn send_now(handle: &ChannelHandle, data: Vec<u8>, text: bool) -> Result<(), String> {
    let res: Result<usize, webrtc::Error> = if text {
        handle
            .dc
            .send_text(String::from_utf8_lossy(&data).as_ref())
            .await
    } else {
        handle.dc.send(&Bytes::from(data)).await
    };
    res.map(|_| ()).map_err(|e| e.to_string())
}

/// Close a single channel, leaving the peer's other channels untouched. The
/// peer is dropped once its last channel is gone.
pub async fn close_channel(
    state: &Arc<NetState>,
    token: String,
    channel_id: u64,
) -> Result<(), String> {
    let peer = peer::find_by_token(state, &token)?;
    let handle = peer
        .channels
        .lock()
        .unwrap()
        .remove(&channel_id)
        .ok_or("channel not found")?;
    let last = peer.channels.lock().unwrap().is_empty();
    handle.dc.close().await.map_err(|e| e.to_string())?;
    if last {
        peer::remove_peer_by_token(state, &token);
    }
    Ok(())
}

/// Register an incoming channel and tell the frontend.
pub async fn register_incoming(
    state: Arc<NetState>,
    target: String,
    dc: Arc<RTCDataChannel>,
) -> Result<(), String> {
    let (peer, channel_id, handle) = {
        let peer = {
            let w = state.webrtc.lock().unwrap();
            w.peers.get(&target).cloned().ok_or("no peer for target")?
        };
        let label = dc.label().to_string();
        let handle = Arc::new(ChannelHandle::new(dc));
        let channel_id = {
            let mut w = state.webrtc.lock().unwrap();
            let id = w.next_channel_id;
            w.next_channel_id += 1;
            id
        };
        peer.channels
            .lock()
            .unwrap()
            .insert(channel_id, handle.clone());
        let _ = state.app.emit(
            "channel-open",
            json!({ "token": peer.token, "channel_id": channel_id, "label": label, "target": target }),
        );
        (peer, channel_id, handle)
    };
    wire_channel(state, peer, channel_id, handle);
    Ok(())
}

/// Wire a channel's data events (open/close/message) to the frontend.
pub fn wire_channel(
    state: Arc<NetState>,
    peer: Arc<Peer>,
    channel_id: u64,
    handle: Arc<ChannelHandle>,
) {
    let h = handle.clone();
    let app = state.app.clone();
    let token = peer.token.clone();
    handle.dc.on_open(Box::new(move || {
        let handle = h.clone();
        let app = app.clone();
        Box::pin(async move {
            handle.open.store(true, Ordering::SeqCst);
            let _ = app.emit(
                "channel-ready",
                json!({ "token": token, "channel_id": channel_id }),
            );
            let queued: Vec<_> = handle.buffer.lock().unwrap().drain(..).collect();
            for (data, text) in queued {
                let _ = send_now(&handle, data, text).await;
            }
            handle.opened.notify_one();
        })
    }));

    let h = handle.clone();
    handle
        .dc
        .on_message(Box::new(move |msg: DataChannelMessage| {
            let handle = h.clone();
            Box::pin(async move {
                push_inbound(&handle, &msg.data, msg.is_string);
            })
        }));

    let app = state.app.clone();
    let net = state.clone();
    let token = peer.token.clone();
    handle.dc.on_close(Box::new(move || {
        let app = app.clone();
        let net = net.clone();
        let token = token.clone();
        Box::pin(async move {
            let _ = app.emit(
                "channel-close",
                json!({ "token": token, "channel_id": channel_id }),
            );
            peer::remove_channel_by_token(&net, &token, channel_id);
        })
    }));
}
