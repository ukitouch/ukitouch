use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Emitter;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::{RTCIceCandidate, RTCIceCandidateInit};
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::sdp_type::RTCSdpType;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use super::state::NetState;

#[derive(Default)]
pub struct WebrtcInner {
    /// Target uuid -> peer.
    pub peers: HashMap<String, Arc<Peer>>,
    next_token: u64,
    next_channel_id: u64,
}

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

/// Bytes held before the frontend binds.
const INBOUND_CAP: usize = 4 * 1024 * 1024;

impl ChannelHandle {
    fn new(dc: Arc<RTCDataChannel>) -> Self {
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
    let peer = find_by_token(state, token)?;
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

pub struct Peer {
    /// A token keeps backend and frontend's communication.
    pub token: String,
    pub pc: Arc<RTCPeerConnection>,
    /// channel_id -> channel.
    pub channels: Mutex<HashMap<u64, Arc<ChannelHandle>>>,
    /// Remote candidates that arrived before the remote description was set.
    pub pending_candidates: Mutex<Vec<RTCIceCandidateInit>>,
    /// Wakes pending `open_channel`s, set to `Some(reason)` when the peer is aborted.
    pub cancelled: tokio::sync::watch::Sender<Option<String>>,
}

/// Cloneable handle that sends a signaling payload to a fixed peer.
#[derive(Clone)]
struct PeerSender {
    state: Arc<NetState>,
    target: String,
}

impl PeerSender {
    async fn send(&self, payload: serde_json::Value) -> Result<(), String> {
        self.state.send_signal(&self.target, payload).await
    }
}

/// Get or lazily create the peer connection to `target`.
async fn get_peer(state: &Arc<NetState>, target: String) -> Result<Arc<Peer>, String> {
    {
        let w = state.webrtc.lock().unwrap();
        if let Some(p) = w.peers.get(&target) {
            return Ok(p.clone());
        }
    }

    let api = APIBuilder::new().build();
    let config = RTCConfiguration {
        ice_servers: state.ice_servers.lock().unwrap().clone(),
        ..Default::default()
    };
    let pc = Arc::new(
        api.new_peer_connection(config)
            .await
            .map_err(|e| e.to_string())?,
    );

    let sender = PeerSender {
        state: state.clone(),
        target: target.clone(),
    };

    // Forward local ICE candidates to the peer.
    let s2 = sender.clone();
    pc.on_ice_candidate(Box::new(move |c: Option<RTCIceCandidate>| {
        let sender = s2.clone();
        Box::pin(async move {
            if let Some(c) = c {
                if let Ok(init) = c.to_json() {
                    let _ = sender.send(json!({ "candidate": init })).await;
                }
            }
        })
    }));

    // Perfect negotiation: create an offer whenever the pc wants one.
    let s3 = sender.clone();
    let pc3 = pc.clone();
    pc.on_negotiation_needed(Box::new(move || {
        let sender = s3.clone();
        let pc = pc3.clone();
        Box::pin(async move {
            if let Ok(offer) = pc.create_offer(None).await {
                if pc.set_local_description(offer.clone()).await.is_ok() {
                    // offer lost, fail the pending connection
                    if let Err(e) = sender.send(json!({ "description": offer })).await {
                        eprintln!("[webrtc] offer send to {} failed: {e}", sender.target);
                        let _ = abort(&sender.state, sender.target.clone(), "signaling unavailable").await;
                    }
                }
            }
        })
    }));

    // Register remote-initiated channels.
    let net = state.clone();
    let target2 = target.clone();
    pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
        let net = net.clone();
        let target = target2.clone();
        Box::pin(async move {
            if let Err(e) = register_incoming(net, target, dc).await {
                eprintln!("[webrtc] on_data_channel failed: {e}");
            }
        })
    }));

    // Send connection state to frontend.
    let app = state.app.clone();
    let net = state.clone();
    let target3 = target.clone();
    pc.on_peer_connection_state_change(Box::new(move |s: RTCPeerConnectionState| {
        let app = app.clone();
        let net = net.clone();
        let target = target3.clone();
        Box::pin(async move {
            let token = net
                .webrtc
                .lock()
                .unwrap()
                .peers
                .get(&target)
                .map(|p| p.token.clone());
            let _ = app.emit(
                "conn-state",
                json!({ "target": target, "token": token, "state": s.to_string() }),
            );
            if s == RTCPeerConnectionState::Failed || s == RTCPeerConnectionState::Closed {
                // Wake any pending open_channel before the peer is gone.
                if let Some(peer) = net.webrtc.lock().unwrap().peers.get(&target) {
                    let _ = peer.cancelled.send(Some("peer connection failed".into()));
                }
                close_peer_channels(&net, &target).await;
                remove_peer_by_target(&net, &target);
            }
        })
    }));

    let (_, peer) = {
        let mut w = state.webrtc.lock().unwrap();
        let token = format!("c{}", w.next_token);
        w.next_token += 1;
        let peer = Arc::new(Peer {
            token: token.clone(),
            pc,
            channels: Mutex::new(HashMap::new()),
            pending_candidates: Mutex::new(Vec::new()),
            cancelled: tokio::sync::watch::channel(None).0,
        });
        w.peers.insert(target.clone(), peer.clone());
        (token, peer)
    };

    Ok(peer)
}

fn find_by_token(state: &Arc<NetState>, token: &str) -> Result<Arc<Peer>, String> {
    let w = state.webrtc.lock().unwrap();
    w.peers
        .values()
        .find(|p| p.token == token)
        .cloned()
        .ok_or_else(|| format!("peer not found: {token}"))
}

fn remove_peer_by_token(state: &Arc<NetState>, token: &str) {
    state
        .webrtc
        .lock()
        .unwrap()
        .peers
        .retain(|_, p| p.token != token);
}

fn remove_peer_by_target(state: &Arc<NetState>, target: &str) {
    state.webrtc.lock().unwrap().peers.remove(target);
}

/// Drop a single channel; the peer goes with the last one.
fn remove_channel_by_token(state: &Arc<NetState>, token: &str, channel_id: u64) {
    let peer = state
        .webrtc
        .lock()
        .unwrap()
        .peers
        .values()
        .find(|p| p.token == token)
        .cloned();
    let Some(peer) = peer else { return };
    let empty = {
        let mut channels = peer.channels.lock().unwrap();
        channels.remove(&channel_id);
        channels.is_empty()
    };
    if empty {
        remove_peer_by_token(state, token);
    }
}

/// The peer connection failed/closed, notify the frontend and close every channel.
async fn close_peer_channels(state: &Arc<NetState>, target: &str) {
    let peer = state.webrtc.lock().unwrap().peers.get(target).cloned();
    let Some(peer) = peer else { return };
    let channels: Vec<(u64, Arc<ChannelHandle>)> = peer.channels.lock().unwrap().drain().collect();
    for (channel_id, handle) in channels {
        let _ = state.app.emit(
            "channel-close",
            json!({ "token": peer.token, "channel_id": channel_id }),
        );
        let _ = handle.dc.close().await;
    }
}

/// Establish a peer connection to `target`, reusing a live one. Returns the
/// connection token, every channel opened under it shares the same connection.
pub async fn connect(state: &Arc<NetState>, target: String) -> Result<String, String> {
    if let Some(p) = state.webrtc.lock().unwrap().peers.get(&target) {
        return Ok(p.token.clone());
    }
    let peer = get_peer(state, target).await?;
    Ok(peer.token.clone())
}

/// Open a data channel on `target`'s connection. Blocks until it opens.
pub async fn open_channel(
    state: &Arc<NetState>,
    token: String,
    label: String,
) -> Result<u64, String> {
    let peer = find_by_token(state, &token)?;
    let dc: Arc<RTCDataChannel> = peer
        .pc
        .create_data_channel(&label, None)
        .await
        .map_err(|e| {
            remove_peer_by_token(state, &token);
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
    wire_channel(state.clone(), peer.clone(), channel_id, handle.clone());

    let mut aborted = peer.cancelled.subscribe();
    if !handle.open.load(std::sync::atomic::Ordering::SeqCst) {
        tokio::select! {
            _ = handle.opened.notified() => {}
            _ = aborted.changed() => {}
            _ = tokio::time::sleep(Duration::from_secs(10)) => {
                remove_peer_by_token(state, &token);
                return Err("channel open timed out".into());
            }
        }
    }
    if !handle.open.load(std::sync::atomic::Ordering::SeqCst) {
        remove_peer_by_token(state, &token);
        let reason = aborted.borrow().clone().unwrap_or_else(|| "connect cancelled".into());
        return Err(reason);
    }
    Ok(channel_id)
}

/// The peer's data channel reader takes at most `u16::MAX` bytes per message.
const MAX_MESSAGE: usize = u16::MAX as usize;

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

    let peer = find_by_token(state, &token)?;
    let handle = peer
        .channels
        .lock()
        .unwrap()
        .get(&channel_id)
        .cloned()
        .ok_or("channel not found")?;
    if !handle.open.load(std::sync::atomic::Ordering::SeqCst) {
        handle.buffer.lock().unwrap().push((data, text));
        return Ok(());
    }
    send_now(&handle, data, text).await
}

/// Close a single channel, leaving the peer's other channels untouched. The
/// peer is dropped once its last channel is gone.
pub async fn close_channel(
    state: &Arc<NetState>,
    token: String,
    channel_id: u64,
) -> Result<(), String> {
    let peer = find_by_token(state, &token)?;
    let handle = peer
        .channels
        .lock()
        .unwrap()
        .remove(&channel_id)
        .ok_or("channel not found")?;
    let last = peer.channels.lock().unwrap().is_empty();
    handle.dc.close().await.map_err(|e| e.to_string())?;
    if last {
        remove_peer_by_token(state, &token);
    }
    Ok(())
}

/// Tear down every peer connection.
pub async fn close_all(state: &Arc<NetState>) -> Result<(), String> {
    let peers: Vec<Arc<Peer>> = state
        .webrtc
        .lock()
        .unwrap()
        .peers
        .drain()
        .map(|(_, peer)| peer)
        .collect();
    for peer in peers {
        let _ = peer.cancelled.send(Some("connection closed".into()));
        let channels: Vec<(u64, Arc<ChannelHandle>)> =
            peer.channels.lock().unwrap().drain().collect();
        for (channel_id, handle) in channels {
            let _ = state.app.emit(
                "channel-close",
                json!({ "token": peer.token, "channel_id": channel_id }),
            );
            let _ = handle.dc.close().await;
        }
        let _ = peer.pc.close().await;
    }
    Ok(())
}

/// Tear down a pending peer connection locally: wake any waiting `open_channel`,
/// drop the peer, and close the PeerConnection.
pub async fn abort(state: &Arc<NetState>, target: String, reason: &str) -> Result<(), String> {
    let peer = state.webrtc.lock().unwrap().peers.remove(&target);
    let Some(peer) = peer else {
        return Ok(()); // nothing pending
    };
    let _ = peer.cancelled.send(Some(reason.to_string()));
    let _ = peer.pc.close().await;
    Ok(())
}

/// Handle an incoming signaling message (SDP / ICE) from `from`.
pub async fn handle_signal(
    state: &Arc<NetState>,
    from: String,
    value: serde_json::Value,
) -> Result<(), String> {
    // Remote peer aborted the connection.
    if value.get("cancel").is_some() {
        return abort(state, from, "remote aborted").await;
    }

    if let Some(desc) = value.get("description") {
        let desc: RTCSessionDescription =
            serde_json::from_value(desc.clone()).map_err(|e| e.to_string())?;
        let peer = get_peer(state, from.clone()).await?;
        if desc.sdp_type == RTCSdpType::Offer {
            peer.pc
                .set_remote_description(desc.clone())
                .await
                .map_err(|e| e.to_string())?;
            let answer = peer
                .pc
                .create_answer(None)
                .await
                .map_err(|e| e.to_string())?;
            peer.pc
                .set_local_description(answer.clone())
                .await
                .map_err(|e| e.to_string())?;
            state
                .send_signal(&from, json!({ "description": answer }))
                .await?;
        } else {
            peer.pc
                .set_remote_description(desc)
                .await
                .map_err(|e| e.to_string())?;
        }
        flush_candidates(&peer).await;
    } else if let Some(cand) = value.get("candidate") {
        let cand: RTCIceCandidateInit =
            serde_json::from_value(cand.clone()).map_err(|e| e.to_string())?;
        let peer = get_peer(state, from).await?;
        if peer.pc.remote_description().await.is_none() {
            // Trickle candidate arrived before the remote description.
            peer.pending_candidates.lock().unwrap().push(cand);
        } else {
            peer.pc
                .add_ice_candidate(cand)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Add any candidates that were buffered before the remote description arrived.
async fn flush_candidates(peer: &Arc<Peer>) {
    let pending: Vec<_> = peer.pending_candidates.lock().unwrap().drain(..).collect();
    for c in pending {
        let _ = peer.pc.add_ice_candidate(c).await;
    }
}

/// Register an incoming channel and tell the frontend.
async fn register_incoming(
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
fn wire_channel(
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
            handle.open.store(true, std::sync::atomic::Ordering::SeqCst);
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
            remove_channel_by_token(&net, &token, channel_id);
        })
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::time::Duration;

    async fn make_pc(
        tx: tokio::sync::mpsc::UnboundedSender<Value>,
        got_msg: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Arc<RTCPeerConnection> {
        let api = APIBuilder::new().build();
        let config = RTCConfiguration::default();
        let pc = Arc::new(api.new_peer_connection(config).await.unwrap());
        pc.on_ice_candidate(Box::new(move |c: Option<RTCIceCandidate>| {
            let tx = tx.clone();
            Box::pin(async move {
                if let Some(c) = c {
                    if let Ok(init) = c.to_json() {
                        let _ = tx.send(json!({ "candidate": init }));
                    }
                }
            })
        }));
        pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
            let got = got_msg.clone();
            Box::pin(async move {
                dc.on_message(Box::new(move |_msg: DataChannelMessage| {
                    let got = got.clone();
                    Box::pin(async move {
                        got.store(true, std::sync::atomic::Ordering::SeqCst);
                    })
                }));
            })
        }));
        pc.on_peer_connection_state_change(Box::new(move |_s: RTCPeerConnectionState| {
            Box::pin(async move {})
        }));
        pc
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn offer_answer_data_channel() {
        let (a2b_tx, mut a2b_rx) = tokio::sync::mpsc::unbounded_channel();
        let (b2a_tx, mut b2a_rx) = tokio::sync::mpsc::unbounded_channel();
        let got = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let a = make_pc(a2b_tx.clone(), got.clone()).await;
        let b = make_pc(b2a_tx.clone(), got.clone()).await;

        // A: negotiation needed -> offer (sent to B via a2b_tx)
        let a2b_for_a = a2b_tx.clone();
        let a2 = a.clone();
        a.on_negotiation_needed(Box::new(move || {
            let a = a2.clone();
            let tx = a2b_for_a.clone();
            Box::pin(async move {
                if let Ok(offer) = a.create_offer(None).await {
                    if a.set_local_description(offer.clone()).await.is_ok() {
                        let _ = tx.send(json!({ "description": offer }));
                    }
                }
            })
        }));

        // A creates a data channel
        let dc = a.create_data_channel("ping", None).await.unwrap();
        let mut opened = false;

        // B: process A's signals (offer -> answer), A processes B's answer
        let b_task = tokio::spawn(async move {
            let mut pending: Vec<RTCIceCandidateInit> = Vec::new();
            while let Some(msg) = a2b_rx.recv().await {
                if let Some(desc) = msg.get("description") {
                    let desc: RTCSessionDescription = serde_json::from_value(desc.clone()).unwrap();
                    b.set_remote_description(desc.clone()).await.unwrap();
                    for c in pending.drain(..) {
                        b.add_ice_candidate(c).await.unwrap();
                    }
                    if desc.sdp_type == RTCSdpType::Offer {
                        let answer = b.create_answer(None).await.unwrap();
                        b.set_local_description(answer.clone()).await.unwrap();
                        b2a_tx.send(json!({ "description": answer })).unwrap();
                    }
                } else if let Some(cand) = msg.get("candidate") {
                    let cand: RTCIceCandidateInit = serde_json::from_value(cand.clone()).unwrap();
                    if b.remote_description().await.is_some() {
                        b.add_ice_candidate(cand).await.unwrap();
                    } else {
                        pending.push(cand);
                    }
                }
            }
        });

        let a_task = tokio::spawn(async move {
            let mut pending: Vec<RTCIceCandidateInit> = Vec::new();
            while let Some(msg) = b2a_rx.recv().await {
                if let Some(desc) = msg.get("description") {
                    let desc: RTCSessionDescription = serde_json::from_value(desc.clone()).unwrap();
                    a.set_remote_description(desc).await.unwrap();
                    for c in pending.drain(..) {
                        a.add_ice_candidate(c).await.unwrap();
                    }
                } else if let Some(cand) = msg.get("candidate") {
                    let cand: RTCIceCandidateInit = serde_json::from_value(cand.clone()).unwrap();
                    if a.remote_description().await.is_some() {
                        a.add_ice_candidate(cand).await.unwrap();
                    } else {
                        pending.push(cand);
                    }
                }
            }
        });

        // Wait for dc to open, then send.
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while std::time::Instant::now() < deadline && !opened {
            if dc.ready_state()
                == webrtc::data_channel::data_channel_state::RTCDataChannelState::Open
            {
                opened = true;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(opened, "data channel never opened");
        dc.send_text("hello").await.unwrap();

        // Give B a moment to receive.
        tokio::time::sleep(Duration::from_millis(500)).await;
        b_task.abort();
        a_task.abort();
        assert!(
            got.load(std::sync::atomic::Ordering::SeqCst),
            "B never received message"
        );
    }
}
