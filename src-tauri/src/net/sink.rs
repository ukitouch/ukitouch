use std::sync::Arc;

use bytes::Bytes;
use webrtc::data_channel::RTCDataChannel;

use super::state::NetState;

/// SCTP's default per-message cap (65536 - 1).
const MAX_MESSAGE: usize = u16::MAX as usize;

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

    /// Ship a frame: a JSON header naming each rectangle and its payload length,
    /// then the concatenated payloads.
    pub async fn push(&self, frame: &[(Rect, &[u8])]) -> Result<(), String> {
        let items: Vec<(Rect, &[u8])> = frame
            .iter()
            .filter(|(r, payload)| r.width > 0 && r.height > 0 && !payload.is_empty())
            .map(|(r, payload)| (*r, *payload))
            .collect();
        if items.is_empty() {
            return Ok(());
        }

        let total: usize = items.iter().map(|(_, payload)| payload.len()).sum();
        let mut header = String::from("{\"frame\":[");
        for (i, (r, payload)) in items.iter().enumerate() {
            if i > 0 {
                header.push(',');
            }
            header.push_str(&format!(
                "{{\"x\":{},\"y\":{},\"w\":{},\"h\":{},\"len\":{}}}",
                r.x,
                r.y,
                r.width,
                r.height,
                payload.len()
            ));
        }
        header.push_str(&format!("],\"total\":{total}}}"));
        self.dc.send_text(header).await.map_err(|e| e.to_string())?;

        for (_, payload) in &items {
            for chunk in payload.chunks(MAX_MESSAGE) {
                self.dc
                    .send(&Bytes::copy_from_slice(chunk))
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
