//! Exposes networking to the frontend: signaling commands/events and the
//! WebRTC P2P commands/events.

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use super::signaling::{self, Event};
use super::state::NetState;
use super::webrtc;
use ::webrtc::ice_transport::ice_server::RTCIceServer;

// signaling

/// Connect and register `id` under `name`. Spawns a reader that routes SDP/ICE
/// to the WebRTC layer and forwards everything else to the frontend.
#[tauri::command]
pub async fn sig_connect(
    app: AppHandle,
    state: State<'_, Arc<NetState>>,
    name: String,
    url: String,
    id: String,
    force: bool,
) -> Result<(), String> {
    let (sender, mut recv) = signaling::connect(&url, id, force);

    // Replace any previous connection under the same name.
    let prev = state.signaling.lock().unwrap().remove(&name);
    if let Some(prev) = prev {
        let _ = prev.disconnect().await;
    }
    state.signaling.lock().unwrap().insert(name.clone(), sender);

    let net = Arc::clone(state.inner());
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = recv.recv().await {
            match ev {
                Event::Forward { from, value } => {
                    if value.get("description").is_some()
                        || value.get("candidate").is_some()
                        || value.get("cancel").is_some()
                    {
                        if let Err(e) = webrtc::handle_signal(&net, from.clone(), value).await {
                            eprintln!("[webrtc] handle_signal error from {from}: {e}");
                        }
                    } else {
                        let _ = app.emit(
                            "sig-forward",
                            serde_json::json!({ "name": name, "from": from, "value": value }),
                        );
                    }
                }
                Event::Notice(msg) => {
                    let _ = app.emit(
                        "sig-notice",
                        serde_json::json!({ "name": name, "message": msg }),
                    );
                }
                Event::Status(status) => {
                    let _ = app.emit(
                        "sig-status",
                        serde_json::json!({ "name": name, "status": status }),
                    );
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn sig_disconnect(state: State<'_, Arc<NetState>>, name: String) -> Result<(), String> {
    let sender = state.signaling.lock().unwrap().remove(&name);
    if let Some(s) = sender {
        s.disconnect().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sig_send(
    state: State<'_, Arc<NetState>>,
    name: String,
    to: String,
    payload: Value,
) -> Result<(), String> {
    let s = state
        .signaling
        .lock()
        .unwrap()
        .get(&name)
        .cloned()
        .ok_or("connection not found")?;
    s.send(&to, payload).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sig_query(
    state: State<'_, Arc<NetState>>,
    name: String,
    id: String,
) -> Result<bool, String> {
    let s = state
        .signaling
        .lock()
        .unwrap()
        .get(&name)
        .cloned()
        .ok_or("connection not found")?;
    s.query(&id).await.map_err(|e| e.to_string())
}

// WebRTC

/// Set the ICE servers used for new peer connections.
#[tauri::command]
pub async fn net_configure(
    state: State<'_, Arc<NetState>>,
    ice_servers: Vec<String>,
) -> Result<(), String> {
    let servers = ice_servers
        .into_iter()
        .map(|u| RTCIceServer {
            urls: vec![u],
            ..Default::default()
        })
        .collect();
    *state.ice_servers.lock().unwrap() = servers;
    Ok(())
}

/// Establish a P2P connection to `target` (uuid). Returns a connection token.
#[tauri::command]
pub async fn p2p_connect(
    state: State<'_, Arc<NetState>>,
    target: String,
) -> Result<String, String> {
    webrtc::connect(&state, target).await
}

/// Open a data channel labelled `label` on the connection `token`.
#[tauri::command]
pub async fn p2p_open_channel(
    state: State<'_, Arc<NetState>>,
    token: String,
    label: String,
) -> Result<u64, String> {
    webrtc::open_channel(&state, token, label).await
}

/// Send raw bytes out on a channel.
#[tauri::command]
pub async fn p2p_send(
    state: State<'_, Arc<NetState>>,
    token: String,
    channel_id: u64,
    data: Vec<u8>,
    text: bool,
) -> Result<(), String> {
    webrtc::send(&state, token, channel_id, data, text).await
}

/// Abort an in-progress connection to `target`.
#[tauri::command]
pub async fn p2p_cancel(state: State<'_, Arc<NetState>>, target: String) -> Result<(), String> {
    webrtc::abort(&state, target.clone()).await?;
    // Tell the remote to abort as well (ignore if signaling is down).
    let _ = state
        .send_signal(&target, serde_json::json!({ "cancel": true }))
        .await;
    Ok(())
}

/// Close a data channel.
#[tauri::command]
pub async fn p2p_close_channel(
    state: State<'_, Arc<NetState>>,
    token: String,
    channel_id: u64,
) -> Result<(), String> {
    webrtc::close_channel(&state, token, channel_id).await
}
