use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Emitter;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;

use super::peer;
use crate::net::state::NetState;

/// The peer's data channel reader takes at most `u16::MAX` bytes per message.
pub(crate) const MAX_MESSAGE: usize = u16::MAX as usize;

/// Max bytes held before the frontend binds.
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
    channel_id: u64,
    sink: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let handle = find_channel(state, channel_id)?;

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
    channel_id: u64,
    data: Vec<u8>,
    text: bool,
) -> Result<(), String> {
    if data.len() > MAX_MESSAGE {
        return Err(format!("message too large: {} bytes", data.len()));
    }

    let handle = find_channel(state, channel_id)?;
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

/// Open a data channel on `target`'s connection. Blocks until it opens.
pub async fn open_channel(
    state: &Arc<NetState>,
    target: String,
    label: String,
) -> Result<u64, String> {
    let peer = state
        .webrtc
        .lock()
        .unwrap()
        .peers
        .get(&target)
        .cloned()
        .ok_or_else(|| format!("no connection to {target}"))?;
    let dc: Arc<RTCDataChannel> = peer
        .pc
        .create_data_channel(&label, None)
        .await
        .map_err(|e| {
            peer::remove_peer(state, &target);
            e.to_string()
        })?;
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
    wire_channel(state.clone(), channel_id, handle.clone());

    // error handling
    let mut aborted = peer.cancelled.subscribe();
    if !handle.open.load(std::sync::atomic::Ordering::SeqCst) {
        tokio::select! {
            _ = handle.opened.notified() => {}
            _ = aborted.changed() => {}
            _ = tokio::time::sleep(Duration::from_secs(10)) => {
                peer::remove_peer(state, &target);
                return Err("channel open timed out".into());
            }
        }
    }
    if !handle.open.load(std::sync::atomic::Ordering::SeqCst) {
        peer::remove_peer(state, &target);
        let reason = aborted
            .borrow()
            .clone()
            .unwrap_or_else(|| "connect cancelled".into());
        return Err(reason);
    }
    Ok(channel_id)
}

/// Close a single channel on a peer.
///
/// Will drop the peer once its last channel is gone.
pub async fn close_channel(state: &Arc<NetState>, channel_id: u64) -> Result<(), String> {
    let handle = remove_channel(state, channel_id)?;
    handle.dc.close().await.map_err(|e| e.to_string())
}

/// Register an incoming channel.
pub async fn register_incoming(
    state: Arc<NetState>,
    target: String,
    dc: Arc<RTCDataChannel>,
) -> Result<(), String> {
    let (channel_id, handle) = {
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
            json!({ "channel_id": channel_id, "label": label, "target": target }),
        );
        (channel_id, handle)
    };
    wire_channel(state, channel_id, handle);
    Ok(())
}

/// Wire a channel's data events (open/close/message) to the frontend.
pub fn wire_channel(state: Arc<NetState>, channel_id: u64, handle: Arc<ChannelHandle>) {
    // on open
    let h = handle.clone();
    let app = state.app.clone();
    handle.dc.on_open(Box::new(move || {
        let handle = h.clone();
        let app = app.clone();
        Box::pin(async move {
            handle.open.store(true, Ordering::SeqCst);
            let _ = app.emit("channel-ready", json!({ "channel_id": channel_id }));
            let queued: Vec<_> = handle.buffer.lock().unwrap().drain(..).collect();
            for (data, text) in queued {
                let _ = send_now(&handle, data, text).await;
            }
            handle.opened.notify_one();
        })
    }));

    // on message
    let h = handle.clone();
    handle
        .dc
        .on_message(Box::new(move |msg: DataChannelMessage| {
            let handle = h.clone();
            Box::pin(async move {
                push_inbound(&handle, &msg.data, msg.is_string);
            })
        }));

    // on close
    let net = state.clone();
    handle.dc.on_close(Box::new(move || {
        let net = net.clone();
        Box::pin(async move {
            let _ = net
                .app
                .emit("channel-close", json!({ "channel_id": channel_id }));
            let _ = remove_channel(&net, channel_id);
        })
    }));
}

/// Find a channel by id.
fn find_channel(state: &Arc<NetState>, channel_id: u64) -> Result<Arc<ChannelHandle>, String> {
    let w = state.webrtc.lock().unwrap();
    for peer in w.peers.values() {
        if let Some(handle) = peer.channels.lock().unwrap().get(&channel_id) {
            return Ok(handle.clone());
        }
    }
    Err("channel not found".into())
}

/// Remove a channel by id, dropping its peer if it was the last one.
fn remove_channel(state: &Arc<NetState>, channel_id: u64) -> Result<Arc<ChannelHandle>, String> {
    let mut w = state.webrtc.lock().unwrap();
    let peer = w
        .peers
        .values()
        .find(|p| p.channels.lock().unwrap().contains_key(&channel_id))
        .cloned()
        .ok_or("channel not found")?;
    let handle = peer.channels.lock().unwrap().remove(&channel_id).unwrap();
    if peer.channels.lock().unwrap().is_empty() {
        w.peers.retain(|_, p| !Arc::ptr_eq(p, &peer));
    }
    Ok(handle)
}
