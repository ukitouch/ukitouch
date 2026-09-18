use std::sync::Arc;

use bytes::Bytes;
use webrtc::data_channel::RTCDataChannel;

use super::state::NetState;

/// SCTP's default per-message cap (`webrtc-sctp`'s `DEFAULT_MAX_MESSAGE_SIZE`).
const MAX_MESSAGE: usize = 65536;

/// Per-tile header: `[x, y, w, h]` as little-endian `u16`.
const HEADER: usize = 8;

/// UDP-like backpressure
const BACKPRESSURE: usize = 256 * 1024;

/// A rectangle of pixels in the transport's own terms.
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// A real-time sink backed by one open data channel.
pub struct ChannelSink {
    dc: Arc<RTCDataChannel>,
}

impl ChannelSink {
    /// Hold the `RTCDataChannel` for `(token, channel_id)`.
    pub fn new(state: &Arc<NetState>, token: &str, channel_id: u64) -> Result<Self, String> {
        let dc = {
            let webrtc = state.webrtc.lock().unwrap();
            let peer = webrtc
                .peers
                .values()
                .find(|p| p.token == token)
                .cloned()
                .ok_or_else(|| format!("peer not found: {token}"))?;
            let channels = peer.channels.lock().unwrap();
            channels
                .get(&channel_id)
                .map(|h| h.dc.clone())
                .ok_or("channel not found")?
        };
        Ok(Self { dc })
    }

    /// Whether shipping now would only add latency.
    pub async fn congested(&self) -> bool {
        self.dc.buffered_amount().await > BACKPRESSURE
    }

    /// Send the stream's shape up front.
    pub async fn announce(&self, width: u16, height: u16) -> Result<(), String> {
        let msg = format!(r#"{{"screen":{{"width":{width},"height":{height}}}}}"#);
        self.dc
            .send_text(msg)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Ship a frame: tile each rectangle into ≤ `MAX_MESSAGE` messages and send.
    pub async fn push(&self, frame: &[(Rect, &[u8])]) -> Result<(), String> {
        for (r, px) in frame {
            if r.width == 0 || r.height == 0 {
                continue;
            }
            let stride = r.width as usize * 4;
            let max_rows = ((MAX_MESSAGE - HEADER) / stride).max(1);
            let mut y = 0u16;
            while y < r.height {
                let h = (max_rows as u16).min(r.height - y);
                let off = y as usize * stride;
                let len = h as usize * stride;
                let mut msg = Vec::with_capacity(HEADER + len);
                msg.extend_from_slice(&r.x.to_le_bytes());
                msg.extend_from_slice(&(r.y + y).to_le_bytes());
                msg.extend_from_slice(&r.width.to_le_bytes());
                msg.extend_from_slice(&h.to_le_bytes());
                msg.extend_from_slice(&px[off..off + len]);
                self.dc
                    .send(&Bytes::from(msg))
                    .await
                    .map_err(|e| e.to_string())?;
                y += h;
            }
        }
        Ok(())
    }
}
