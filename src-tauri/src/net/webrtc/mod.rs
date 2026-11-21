pub mod bridge;
pub mod channel;
pub mod peer;
pub mod pipe;
pub mod signaling;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use webrtc::ice_transport::ice_server::RTCIceServer;

use signaling::{SignalingReceiver, SignalingSender};

use crate::net::state::NetState;

#[derive(Default)]
pub struct WebrtcInner {
    /// Target uuid -> peer.
    pub peers: HashMap<String, Arc<peer::Peer>>,
    /// Named signaling connections ("primary", "temp", ...).
    pub signaling: Mutex<HashMap<String, SignalingSender>>,
    /// Routes each signaling connection's events into this module.
    pub routes: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    /// ICE servers for new peer connections.
    pub ice_servers: Mutex<Vec<RTCIceServer>>,
    next_token: u64,
    next_channel_id: u64,
}

pub use channel::{bind, close_channel, send};
pub use peer::{abort, close_all, connect, open_channel};

/// Attach a signaling client under `name` and spawn its event router.
/// Returns the previous connection under the same name, if any.
pub fn signal_attach(
    state: Arc<NetState>,
    name: String,
    sender: SignalingSender,
    mut recv: SignalingReceiver,
) -> Option<SignalingSender> {
    let w = state.webrtc.lock().unwrap();
    if let Some(h) = w.routes.lock().unwrap().remove(&name) {
        h.abort();
    }
    let prev = w.signaling.lock().unwrap().insert(name.clone(), sender);
    let app = state.app.clone();
    let net = state.clone();
    let name_task = name.clone();
    let handle = tauri::async_runtime::spawn(async move {
        while let Some(ev) = recv.recv().await {
            peer::route(&app, &net, &name_task, ev).await;
        }
    });
    w.routes.lock().unwrap().insert(name, handle);
    prev
}

/// Remove the connection under `name` and stop its router.
pub fn signal_detach(state: &Arc<NetState>, name: &str) -> Option<SignalingSender> {
    let w = state.webrtc.lock().unwrap();
    w.routes.lock().unwrap().remove(name);
    let prev = w.signaling.lock().unwrap().remove(name);
    prev
}

pub async fn signal_send(
    state: &Arc<NetState>,
    name: &str,
    to: &str,
    payload: Value,
) -> Result<(), String> {
    let sender = get_signaling(state, name)?;
    sender.send(to, payload).await.map_err(|e| e.to_string())
}

pub async fn signal_query(state: &Arc<NetState>, name: &str, id: &str) -> Result<bool, String> {
    let sender = get_signaling(state, name)?;
    sender.query(id).await.map_err(|e| e.to_string())
}

fn get_signaling(state: &Arc<NetState>, name: &str) -> Result<SignalingSender, String> {
    state
        .webrtc
        .lock()
        .unwrap()
        .signaling
        .lock()
        .unwrap()
        .get(name)
        .cloned()
        .ok_or("connection not found".into())
}

/// Set the ICE servers used for new peer connections.
pub fn set_ice_servers(state: &Arc<NetState>, urls: Vec<String>) {
    let servers = urls
        .into_iter()
        .map(|u| RTCIceServer {
            urls: vec![u],
            ..Default::default()
        })
        .collect();
    *state.webrtc.lock().unwrap().ice_servers.lock().unwrap() = servers;
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use serde_json::Value;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::Duration;
    use webrtc::api::APIBuilder;
    use webrtc::data_channel::data_channel_message::DataChannelMessage;
    use webrtc::data_channel::RTCDataChannel;
    use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
    use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
    use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
    use webrtc::peer_connection::RTCPeerConnection;

    async fn make_pc(
        tx: tokio::sync::mpsc::UnboundedSender<Value>,
        got_msg: Arc<AtomicBool>,
    ) -> Arc<RTCPeerConnection> {
        let api = APIBuilder::new().build();
        let config = webrtc::peer_connection::configuration::RTCConfiguration::default();
        let pc = Arc::new(api.new_peer_connection(config).await.unwrap());
        pc.on_ice_candidate(Box::new(move |c: Option<webrtc::ice_transport::ice_candidate::RTCIceCandidate>| {
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
        let got = Arc::new(AtomicBool::new(false));

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
                    if desc.sdp_type
                        == webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Offer
                    {
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
