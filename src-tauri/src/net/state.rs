//! Central networking state shared by the WebRTC, USB, and pipe layers.

use std::sync::Mutex;
use tauri::AppHandle;

use crate::net::usb::UsbState;

use super::webrtc::WebrtcState;

pub struct NetState {
    /// WebRTC peers and their signaling connections.
    pub webrtc: Mutex<WebrtcState>,
    /// USB (adb) channels.
    pub usb: Mutex<UsbState>,
    /// Frontend event emitter.
    pub app: AppHandle,
}

impl NetState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            webrtc: Mutex::new(WebrtcState::default()),
            usb: Mutex::new(UsbState::default()),
            app,
        }
    }
}
