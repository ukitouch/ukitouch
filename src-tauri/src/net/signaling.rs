//! Signaling client speaking the `p2psig` server protocol.
//!
//! Wire protocol (see `mix/p2p-test/rs/src/main.rs`):
//! - client -> server `{"register":"<id>","force":bool}`  register an id
//! - client -> server `{"query":"<id>"}`                  server replies `{"id":"..","registered":bool}`
//! - client -> server `{"from":"<a>","to":"<b>",..}`      server forwards the same text to `b`
//! - server -> client  bare strings for errors/notices     (`id \`x\` taken`, `b offline`, ...)

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

/// Events pushed up from the signaling socket.
#[derive(Debug)]
pub enum Event {
    /// The server forwarded a message to us from another peer.
    Forward { from: String, value: Value },
    /// Bare-string server notice / error.
    Notice(String),
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WriteHalf = futures_util::stream::SplitSink<Ws, Message>;

/// Send half of a signaling connection.
#[derive(Clone)]
pub struct SignalingSender {
    /// Own registration id on the server.
    id: String,
    /// Current write sink, `None` while the connection is down.
    write: Arc<Mutex<Option<WriteHalf>>>,
    /// In-flight `query` calls keyed by the queried id.
    pending_queries: Arc<std::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    /// Set by `disconnect` to stop the reconnect loop.
    closed: Arc<AtomicBool>,
}

/// Receive half of a signaling connection.
pub struct SignalingReceiver {
    rx: mpsc::Receiver<Event>,
}

impl SignalingSender {
    /// Send `payload` to peer `to`; the server forwards it as-is.
    pub async fn send(&self, to: &str, payload: Value) -> Result<(), Error> {
        let mut map = serde_json::Map::new();
        map.insert("from".into(), Value::String(self.id.clone()));
        map.insert("to".into(), Value::String(to.to_string()));
        if let Value::Object(rest) = payload {
            map.extend(rest);
        }
        let text = serde_json::Value::Object(map).to_string();
        let mut guard = self.write.lock().await;
        let w = guard.as_mut().ok_or(Error::Other("not connected".into()))?;
        w.send(Message::Text(text.into()))
            .await
            .map_err(Error::Send)
    }

    /// Close the connection and stop reconnecting.
    pub async fn disconnect(&self) -> Result<(), Error> {
        self.closed.store(true, Ordering::SeqCst);
        let mut guard = self.write.lock().await;
        if let Some(w) = guard.as_mut() {
            let _ = w.send(Message::Close(None)).await;
        }
        Ok(())
    }

    /// Ask the server whether `id` is currently registered. Timeouts if the
    /// server never replies.
    pub async fn query(&self, id: &str) -> Result<bool, Error> {
        let (tx, rx) = oneshot::channel();
        self.pending_queries
            .lock()
            .unwrap()
            .insert(id.to_string(), tx);
        {
            let mut guard = self.write.lock().await;
            let w = guard.as_mut().ok_or(Error::Other("not connected".into()))?;
            w.send(Message::Text(
                serde_json::json!({ "query": id }).to_string().into(),
            ))
            .await
            .map_err(Error::Send)?;
        }
        tokio::time::timeout(Duration::from_secs(3), rx)
            .await
            .map_err(|_| Error::Other("query timed out".into()))?
            .map_err(|_| Error::Other("query timed out".into()))
    }
}

impl SignalingReceiver {
    /// Next event from the server.
    pub async fn recv(&mut self) -> Option<Event> {
        self.rx.recv().await
    }
}

async fn handle_text(
    text: String,
    tx: &mpsc::Sender<Event>,
    pending_queries: &std::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>,
) {
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        // query reply: {"id": ..., "registered": bool}
        if let (Some(id), Some(registered)) = (
            v.get("id").and_then(Value::as_str),
            v.get("registered").and_then(Value::as_bool),
        ) {
            if let Some(tx) = pending_queries.lock().unwrap().remove(id) {
                let _ = tx.send(registered);
            }
            return;
        }
        // forwarded message carries from/to
        if let Some(from) = v.get("from").and_then(Value::as_str) {
            let ev = Event::Forward {
                from: from.to_string(),
                value: v,
            };
            let _ = tx.send(ev).await;
            return;
        }
        // unknown JSON -> treat as notice
        let _ = tx.send(Event::Notice(text)).await;
    } else {
        // bare-string errors/notices
        let _ = tx.send(Event::Notice(text)).await;
    }
}

/// Connect and register `id` on the server, returning split send/receive halves.
pub async fn connect(
    url: &str,
    id: String,
    force: bool,
) -> Result<(SignalingSender, SignalingReceiver), Error> {
    let url = url.to_string();
    let (ws, _) = connect_async(&url).await.map_err(Error::Connect)?;
    let (mut write, mut read) = ws.split();

    write
        .send(Message::Text(
            serde_json::json!({ "register": id, "force": force })
                .to_string()
                .into(),
        ))
        .await
        .map_err(Error::Send)?;

    let (tx, rx) = mpsc::channel(64);
    let write_shared: Arc<Mutex<Option<WriteHalf>>> = Arc::new(Mutex::new(Some(write)));
    let pending_queries: Arc<std::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>> =
        Arc::new(std::sync::Mutex::new(HashMap::new()));
    let closed = Arc::new(AtomicBool::new(false));

    let pq = pending_queries.clone();
    let write_mgr = write_shared.clone();
    let closed_mgr = closed.clone();
    let tx_mgr = tx.clone();
    let id_mgr = id.clone();
    tokio::spawn(async move {
        // Drain the initial socket, reconnect in a loop.
        while let Some(msg) = read.next().await {
            if closed_mgr.load(Ordering::SeqCst) {
                return;
            }
            match msg {
                Ok(Message::Text(t)) => handle_text(t.to_string(), &tx_mgr, &pq).await,
                _ => {}
            }
        }

        // Initial connection dropped, reconnect forever (until closed).
        loop {
            if closed_mgr.load(Ordering::SeqCst) {
                return;
            }
            *write_mgr.lock().await = None; // drop the stale write half
            tokio::time::sleep(Duration::from_secs(2)).await;
            if closed_mgr.load(Ordering::SeqCst) {
                return;
            }
            let (ws, _) = match connect_async(&url).await {
                Ok(w) => w,
                Err(_) => continue,
            };
            let (mut write, mut read) = ws.split();
            let _ = write
                .send(Message::Text(
                    serde_json::json!({ "register": id_mgr, "force": true })
                        .to_string()
                        .into(),
                ))
                .await;
            *write_mgr.lock().await = Some(write);
            while let Some(msg) = read.next().await {
                if closed_mgr.load(Ordering::SeqCst) {
                    return;
                }
                match msg {
                    Ok(Message::Text(t)) => handle_text(t.to_string(), &tx_mgr, &pq).await,
                    _ => {}
                }
            }
        }
    });

    let sender = SignalingSender {
        id,
        write: write_shared,
        pending_queries,
        closed,
    };
    let receiver = SignalingReceiver { rx };
    Ok((sender, receiver))
}

#[derive(Debug)]
pub enum Error {
    Connect(tokio_tungstenite::tungstenite::Error),
    Send(tokio_tungstenite::tungstenite::Error),
    Other(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Connect(e) => write!(f, "connect: {e}"),
            Error::Send(e) => write!(f, "send: {e}"),
            Error::Other(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for Error {}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live smoke test against the configured signaling server.
    ///
    /// Skips (silently) when `VITE_SIGNALING` is not set or the server is down.
    #[tokio::test(flavor = "multi_thread")]
    async fn register_forward_query_roundtrip() {
        let url = match std::env::var("VITE_SIGNALING").ok() {
            Some(u) => u,
            None => return, // not configured; skip
        };

        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let (a_sender, a_recv) = match connect(&url, format!("test-{suffix}-a"), true).await {
            Ok(c) => c,
            Err(_) => return, // server unreachable; skip
        };
        let (b_sender, mut b_recv) = connect(&url, format!("test-{suffix}-b"), true)
            .await
            .expect("b connect");

        let to = format!("test-{suffix}-b");
        // The server processes connections concurrently; a's forward could race
        // b's register. Wait until the server confirms b is registered first.
        for _ in 0..30 {
            if a_sender.query(&to).await.expect("query") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // a -> b forward
        a_sender
            .send(&to, serde_json::json!({ "hello": "world" }))
            .await
            .expect("a send");
        match tokio::time::timeout(Duration::from_secs(3), b_recv.recv())
            .await
            .expect("timeout")
            .expect("stream closed")
        {
            Event::Forward { from, value } => {
                assert_eq!(from, format!("test-{suffix}-a"));
                assert_eq!(value["hello"], "world");
            }
            other => panic!("expected Forward, got {other:?}"),
        }

        // query registration
        assert_eq!(a_sender.query(&to).await.expect("query"), true);
        assert_eq!(a_sender.query("nope").await.expect("query"), false);
        drop(b_sender);
        drop(a_recv);
    }
}
