//! Central networking state shared by the signaling bridge and the WebRTC layer.

use std::collections::HashMap;
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
}
