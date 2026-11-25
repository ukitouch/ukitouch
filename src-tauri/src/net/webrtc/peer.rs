use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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

impl Peer {
    /// Close all channels on this peer.
    async fn close_channels(&self, app: &AppHandle, reason: &str) {
        let _ = self.cancelled.send(Some(reason.to_string()));
        let channels: Vec<(u64, Arc<ChannelHandle>)> =
            self.channels.lock().unwrap().drain().collect();
        for (channel_id, handle) in channels {
            let _ = app.emit(
                "channel-close",
                json!({ "token": self.token, "channel_id": channel_id }),
            );
            let _ = handle.dc.close().await;
        }
    }
}

/// Get or create the peer connection to `target`.
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

    // Forward local ICE candidates to the peer.
    let ice_state = state.clone();
    let ice_target = target.clone();
    pc.on_ice_candidate(Box::new(move |c: Option<RTCIceCandidate>| {
        let state = ice_state.clone();
        let target = ice_target.clone();
        Box::pin(async move {
            if let Some(c) = c {
                if let Ok(init) = c.to_json() {
                    let _ = super::signal_send(
                        &state,
                        "primary",
                        &target,
                        json!({ "candidate": init }),
                    )
                    .await;
                }
            }
        })
    }));

    // Create an offer when the pc needs.
    let pc2 = pc.clone();
    let negotiation_state = state.clone();
    let negotiation_target = target.clone();
    pc.on_negotiation_needed(Box::new(move || {
        let pc = pc2.clone();
        let state = negotiation_state.clone();
        let target = negotiation_target.clone();
        Box::pin(async move {
            if let Ok(offer) = pc.create_offer(None).await {
                if pc.set_local_description(offer.clone()).await.is_ok() {
                    if let Err(e) = super::signal_send(
                        &state,
                        "primary",
                        &target,
                        json!({ "description": offer }),
                    )
                    .await
                    {
                        eprintln!("[webrtc] offer send to {} failed: {e}", target);
                        let _ = abort(&state, target.clone(), "signaling unavailable").await;
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

    // Clean up when the peer connection fails or closes.
    let net = state.clone();
    let target3 = target.clone();
    pc.on_peer_connection_state_change(Box::new(move |s: RTCPeerConnectionState| {
        let net = net.clone();
        let target = target3.clone();
        Box::pin(async move {
            if s == RTCPeerConnectionState::Failed || s == RTCPeerConnectionState::Closed {
                let peer = net.webrtc.lock().unwrap().peers.get(&target).cloned();
                if let Some(peer) = peer {
                    peer.close_channels(&net.app, "peer connection failed")
                        .await;
                    net.webrtc.lock().unwrap().peers.remove(&target);
                }
            }
        })
    }));

    // construct Peer
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

/// Establish a peer connection to `target`, reusing a live one.
///
/// Returns the connection token.
pub async fn connect(state: &Arc<NetState>, target: String) -> Result<String, String> {
    if let Some(p) = state.webrtc.lock().unwrap().peers.get(&target) {
        return Ok(p.token.clone());
    }

    let peer = get_peer(state, target).await?;
    Ok(peer.token.clone())
}

/// Handle an incoming signaling message (SDP / ICE) from `from`.
async fn handle_signal(state: &Arc<NetState>, from: String, value: Value) -> Result<(), String> {
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

        // Add any candidates that were buffered before the remote description arrived.
        let pending: Vec<_> = peer.pending_candidates.lock().unwrap().drain(..).collect();
        for c in pending {
            let _ = peer.pc.add_ice_candidate(c).await;
        }
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

pub fn find_peer_by_token(state: &Arc<NetState>, token: &str) -> Result<Arc<Peer>, String> {
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
        peer.close_channels(&state.app, "connection closed").await;
        let _ = peer.pc.close().await;
    }
    Ok(())
}

/// Tear down a pending peer connection.
pub async fn abort(state: &Arc<NetState>, target: String, reason: &str) -> Result<(), String> {
    let peer = state.webrtc.lock().unwrap().peers.remove(&target);
    let Some(peer) = peer else {
        return Ok(()); // nothing pending
    };
    let _ = peer.cancelled.send(Some(reason.to_string()));
    let _ = peer.pc.close().await;
    Ok(())
}
