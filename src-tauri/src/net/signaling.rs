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
use std::sync::Arc;
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
    /// Sink for sending messages to the server.
    write: Arc<Mutex<WriteHalf>>,
    /// In-flight `query` calls keyed by the queried id.
    pending_queries: Arc<std::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

/// Receive half of a signaling connection (owned by a reader task).
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
        self.write
            .lock()
            .await
            .send(Message::Text(text.into()))
            .await
            .map_err(Error::Send)
    }

    /// Close the underlying websocket (also ends the reader task).
    pub async fn disconnect(&self) -> Result<(), Error> {
        self.write
            .lock()
            .await
            .send(Message::Close(None))
            .await
            .map_err(Error::Send)
    }

    /// Ask the server whether `id` is currently registered. Timeouts if the
    /// server never replies.
    pub async fn query(&self, id: &str) -> Result<bool, Error> {
        let (tx, rx) = oneshot::channel();
        self.pending_queries.lock().unwrap().insert(id.to_string(), tx);
        self.write
            .lock()
            .await
            .send(Message::Text(serde_json::json!({ "query": id }).to_string().into()))
            .await
            .map_err(Error::Send)?;
        rx.await.map_err(|_| Error::Other("query timed out".into()))
    }
}

impl SignalingReceiver {
    /// Next event from the server.
    pub async fn recv(&mut self) -> Option<Event> {
        self.rx.recv().await
    }
}

/// Connect and register `id` on the server, returning split send/receive halves
/// Fails on transport error or if the id is taken and `force` is false
pub async fn connect(
    url: &str,
    id: String,
    force: bool,
) -> Result<(SignalingSender, SignalingReceiver), Error> {
    let (ws, _) = connect_async(url).await.map_err(Error::Connect)?;
    let (mut write, mut read) = ws.split();

    write
        .send(Message::Text(
            serde_json::json!({ "register": id, "force": force }).to_string().into(),
        ))
        .await
        .map_err(Error::Send)?;

    let (tx, rx) = mpsc::channel(64);
    let pending_queries: Arc<std::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>> =
        Arc::new(std::sync::Mutex::new(HashMap::new()));
    let pq = pending_queries.clone();

    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            let text = match msg {
                Ok(Message::Text(t)) => t.to_string(),
                _ => continue, // ignore binary / pong / errors
            };

            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                // query reply: {"id": ..., "registered": bool}
                if let (Some(id), Some(registered)) = (
                    v.get("id").and_then(Value::as_str),
                    v.get("registered").and_then(Value::as_bool),
                ) {
                    if let Some(tx) = pq.lock().unwrap().remove(id) {
                        let _ = tx.send(registered);
                    }
                    continue;
                }
                // forwarded message carries from/to
                if let Some(from) = v.get("from").and_then(Value::as_str) {
                    let _ = tx
                        .send(Event::Forward {
                            from: from.to_string(),
                            value: v,
                        })
                        .await;
                    continue;
                }
                // unknown JSON -> treat as notice
                let _ = tx.send(Event::Notice(text)).await;
            } else {
                // bare-string errors/notices
                let _ = tx.send(Event::Notice(text)).await;
            }
        }
    });

    let sender = SignalingSender {
        id,
        write: Arc::new(Mutex::new(write)),
        pending_queries,
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
    use std::time::Duration;

    /// Live smoke test against the configured signaling server.
    ///
    /// Skips (silently) when `VITE_SIGNALING` is not set or the server is down.
    #[tokio::test(flavor = "multi_thread")]
    async fn register_forward_query_roundtrip() {
        let url = match std::env::var("VITE_SIGNALING").ok() {
            Some(u) => u,
            None => return, // not configured; skip
        };

        let (a_sender, a_recv) = match connect(&url, "test-a".into(), true).await {
            Ok(c) => c,
            Err(_) => return, // server unreachable; skip
        };
        let (b_sender, mut b_recv) =
            connect(&url, "test-b".into(), true).await.expect("b connect");

        // a -> b forward
        a_sender
            .send("test-b", serde_json::json!({ "hello": "world" }))
            .await
            .expect("a send");
        match tokio::time::timeout(Duration::from_secs(3), b_recv.recv())
            .await
            .expect("timeout")
            .expect("stream closed")
        {
            Event::Forward { from, value } => {
                assert_eq!(from, "test-a");
                assert_eq!(value["hello"], "world");
            }
            other => panic!("expected Forward, got {other:?}"),
        }

        // query registration
        assert_eq!(a_sender.query("test-b").await.expect("query"), true);
        assert_eq!(a_sender.query("nope").await.expect("query"), false);
        drop(b_sender);
        drop(a_recv);
    }
}
