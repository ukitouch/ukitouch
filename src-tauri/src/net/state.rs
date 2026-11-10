//! Central networking state shared by the signaling bridge and the WebRTC layer.

use bytes::Bytes;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::AppHandle;
use webrtc::ice_transport::ice_server::RTCIceServer;

use super::signaling::SignalingSender;
use super::usb::UsbInner;
use super::webrtc::WebrtcInner;

pub struct NetState {
    /// Named signaling connections, keyed by `name` ("primary", "temp", ...).
    pub signaling: Mutex<HashMap<String, SignalingSender>>,
    /// WebRTC peers.
    pub webrtc: Mutex<WebrtcInner>,
    /// USB (adb) channels.
    pub usb: Mutex<UsbInner>,
    /// Frontend event emitter.
    pub app: AppHandle,
    /// ICE servers for new peer connections.
    pub ice_servers: Mutex<Vec<RTCIceServer>>,
}

impl NetState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            signaling: Mutex::new(HashMap::new()),
            webrtc: Mutex::new(WebrtcInner::default()),
            usb: Mutex::new(UsbInner::default()),
            app,
            ice_servers: Mutex::new(Vec::new()),
        }
    }

    /// Send `payload` to peer `to` over the primary signaling connection.
    pub async fn send_signal(&self, to: &str, payload: serde_json::Value) -> Result<(), String> {
        let sender = self
            .signaling
            .lock()
            .unwrap()
            .get("primary")
            .cloned()
            .ok_or("signaling not connected")?;
        sender.send(to, payload).await.map_err(|e| e.to_string())
    }

    /// Send raw bytes on a P2P data channel.
    pub async fn send_bytes(
        &self,
        token: &str,
        channel_id: u64,
        data: Vec<u8>,
        text: bool,
    ) -> Result<(), String> {
        let handle = {
            let webrtc = self
                .webrtc
                .lock()
                .map_err(|e| format!("webrtc lock poisoned: {e}"))?;
            let peer = webrtc
                .peers
                .values()
                .find(|p| p.token == token)
                .cloned()
                .ok_or_else(|| format!("peer not found: {token}"))?;
            drop(webrtc);

            let channels = peer
                .channels
                .lock()
                .map_err(|e| format!("channels lock poisoned: {e}"))?;
            let handle = channels
                .get(&channel_id)
                .cloned()
                .ok_or_else(|| format!("data channel {channel_id} not found"))?;
            handle
        };

        // Queue in the buffer if channel is not opened yet.
        if !handle.open.load(Ordering::Relaxed) {
            let mut buffer = handle
                .buffer
                .lock()
                .map_err(|e| format!("buffer lock poisoned: {e}"))?;
            buffer.push((data, text));
            return Ok(());
        }

        if text {
            let text = String::from_utf8(data).map_err(|e| e.to_string())?;
            handle
                .dc
                .send_text(text)
                .await
                .map_err(|e| format!("data channel send failed: {e}"))?;
        } else {
            handle
                .dc
                .send(&Bytes::from(data))
                .await
                .map_err(|e| format!("data channel send failed: {e}"))?;
        }

        Ok(())
    }
}
