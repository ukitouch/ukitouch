//! Central networking state shared by the WebRTC, USB, and pipe layers.

use std::sync::Mutex;
use tauri::AppHandle;

use super::usb::UsbInner;
use super::webrtc::WebrtcInner;

pub struct NetState {
    /// WebRTC peers and their signaling connections.
    pub webrtc: Mutex<WebrtcInner>,
    /// USB (adb) channels.
    pub usb: Mutex<UsbInner>,
    /// Frontend event emitter.
    pub app: AppHandle,
}

impl NetState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            webrtc: Mutex::new(WebrtcInner::default()),
            usb: Mutex::new(UsbInner::default()),
            app,
        }
    }
}
