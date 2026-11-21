use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use webrtc::api::APIBuilder;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::{RTCIceCandidate, RTCIceCandidateInit};
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::sdp_type::RTCSdpType;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use super::channel::{self, ChannelHandle};
use super::signaling::Event;
use crate::net::state::NetState;

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
    async fn send(&self, payload: Value) -> Result<(), String> {
        super::signal_send(&self.state, "primary", &self.target, payload).await
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
        ice_servers: state
            .webrtc
            .lock()
            .unwrap()
            .ice_servers
            .lock()
            .unwrap()
            .clone(),
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
                        let _ = abort(
                            &sender.state,
                            sender.target.clone(),
                            "signaling unavailable",
                        )
                        .await;
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
            if let Err(e) = channel::register_incoming(net, target, dc).await {
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
    channel::wire_channel(state.clone(), peer.clone(), channel_id, handle.clone());

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
        let reason = aborted
            .borrow()
            .clone()
            .unwrap_or_else(|| "connect cancelled".into());
        return Err(reason);
    }
    Ok(channel_id)
}

/// Handle an incoming signaling message (SDP / ICE) from `from`.
pub async fn handle_signal(
    state: &Arc<NetState>,
    from: String,
    value: Value,
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
            super::signal_send(state, "primary", &from, json!({ "description": answer })).await?;
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

/// Route SDP/ICE to the peer layer, everything else to the frontend.
pub async fn route(app: &AppHandle, state: &Arc<NetState>, name: &str, ev: Event) {
    match ev {
        Event::Forward { from, value } => {
            if value.get("description").is_some()
                || value.get("candidate").is_some()
                || value.get("cancel").is_some()
            {
                if let Err(e) = handle_signal(state, from.clone(), value).await {
                    eprintln!("[webrtc] handle_signal error from {from}: {e}");
                }
            } else {
                let _ = app.emit(
                    "sig-forward",
                    json!({ "name": name, "from": from, "value": value }),
                );
            }
        }
        Event::Notice(msg) => {
            let _ = app.emit("sig-notice", json!({ "name": name, "message": msg }));
        }
        Event::Error(value) => {
            // peer is offline, fail the pending connection
            if value.get("error").and_then(Value::as_str) == Some("offline") {
                if let Some(to) = value.get("to").and_then(Value::as_str) {
                    let _ = abort(state, to.to_string(), "peer is offline").await;
                }
            }
            let _ = app.emit("sig-error", json!({ "name": name, "error": value }));
        }
        Event::Status(status) => {
            let _ = app.emit("sig-status", json!({ "name": name, "status": status }));
        }
    }
}

pub fn find_by_token(state: &Arc<NetState>, token: &str) -> Result<Arc<Peer>, String> {
    let w = state.webrtc.lock().unwrap();
    w.peers
        .values()
        .find(|p| p.token == token)
        .cloned()
        .ok_or_else(|| format!("peer not found: {token}"))
}

pub fn remove_peer_by_token(state: &Arc<NetState>, token: &str) {
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
pub fn remove_channel_by_token(state: &Arc<NetState>, token: &str, channel_id: u64) {
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
pub async fn close_peer_channels(state: &Arc<NetState>, target: &str) {
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
