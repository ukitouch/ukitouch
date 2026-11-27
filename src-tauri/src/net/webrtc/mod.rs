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
pub struct WebrtcState {
    /// Target uuid -> peer.
    pub peers: HashMap<String, Arc<peer::Peer>>,
    /// Named signaling connections ("primary", "temp").
    pub signaling: Mutex<HashMap<String, SignalingSender>>,
    /// Routes each signaling connection's events into this module.
    pub routes: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    /// ICE servers for new peer connections.
    pub ice_servers: Mutex<Vec<RTCIceServer>>,
    next_channel_id: u64,
}

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
