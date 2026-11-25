//! Exposes signaling and WebRTC commands/events to the frontend.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::State;

use crate::net::state::NetState;

/// Connect and register `id` under `name`.
#[tauri::command]
pub async fn sig_connect(
    state: State<'_, Arc<NetState>>,
    name: String,
    url: String,
    id: String,
    force: bool,
) -> Result<(), String> {
    let (sender, recv) = super::signaling::connect(&url, id, force);
    let prev = super::signal_attach(state.inner().clone(), name, sender, recv);
    if let Some(prev) = prev {
        let _ = prev.disconnect().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn sig_disconnect(state: State<'_, Arc<NetState>>, name: String) -> Result<(), String> {
    if let Some(s) = super::signal_detach(state.inner(), &name) {
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
    super::signal_send(state.inner(), &name, &to, payload).await
}

#[tauri::command]
pub async fn sig_query(
    state: State<'_, Arc<NetState>>,
    name: String,
    id: String,
) -> Result<bool, String> {
    super::signal_query(state.inner(), &name, &id).await
}

/// Set the ICE servers used for new peer connections.
#[tauri::command]
pub async fn net_configure(
    state: State<'_, Arc<NetState>>,
    ice_servers: Vec<String>,
) -> Result<(), String> {
    super::set_ice_servers(state.inner(), ice_servers);
    Ok(())
}

/// Establish a WebRTC connection to `target`. Returns a connection token.
#[tauri::command]
pub async fn webrtc_connect(
    state: State<'_, Arc<NetState>>,
    target: String,
) -> Result<String, String> {
    super::connect(state.inner(), target).await
}

/// Open a data channel labelled `label` on the connection `token`.
#[tauri::command]
pub async fn webrtc_open_channel(
    state: State<'_, Arc<NetState>>,
    token: String,
    label: String,
) -> Result<u64, String> {
    super::open_channel(state.inner(), token, label).await
}

/// Send raw bytes out on a channel.
#[tauri::command]
pub async fn webrtc_send(
    state: State<'_, Arc<NetState>>,
    token: String,
    channel_id: u64,
    data: Vec<u8>,
    text: bool,
) -> Result<(), String> {
    super::send(state.inner(), token, channel_id, data, text).await
}

/// Bind a channel to the frontend, and send all buffered data to it.
#[tauri::command]
pub async fn webrtc_bind(
    state: State<'_, Arc<NetState>>,
    token: String,
    channel_id: u64,
    on_data: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<(), String> {
    super::bind(state.inner(), &token, channel_id, on_data)
}

/// Abort an in-progress connection to `target`.
#[tauri::command]
pub async fn webrtc_cancel(state: State<'_, Arc<NetState>>, target: String) -> Result<(), String> {
    super::abort(state.inner(), target.clone(), "connection cancelled").await?;
    // Tell the remote to abort as well (ignore if signaling is down).
    let _ = super::signal_send(state.inner(), "primary", &target, json!({ "cancel": true })).await;
    Ok(())
}

/// Close a data channel.
#[tauri::command]
pub async fn webrtc_close_channel(
    state: State<'_, Arc<NetState>>,
    token: String,
    channel_id: u64,
) -> Result<(), String> {
    super::close_channel(state.inner(), token, channel_id).await
}

/// Close every WebRTC connection.
#[tauri::command]
pub async fn webrtc_close_all(state: State<'_, Arc<NetState>>) -> Result<(), String> {
    super::close_all(state.inner()).await
}
