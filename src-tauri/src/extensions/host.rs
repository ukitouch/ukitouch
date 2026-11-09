use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, RwLock};

use crate::extensions::package::ExtensionManifest;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ExtMessage {
    /// First message a sidecar sends to announce what it can do.
    Register {
        capabilities: Vec<String>,
        version: String,
    },
    /// Response to a single `call` request, matched by `id`.
    Reply {
        id: u64,
        #[serde(default)]
        result: Option<Value>,
        #[serde(default)]
        error: Option<String>,
    },
    /// One-way event pushed from the sidecar to the frontend.
    Event { event: String, payload: Value },
}

#[derive(Debug, Serialize)]
struct CallMessage<'a> {
    kind: &'a str,
    id: u64,
    method: &'a str,
    payload: &'a Value,
}

struct Sidecar {
    /// Writable handle to the sidecar's stdin.
    stdin: Arc<Mutex<ChildStdin>>,
    /// In-flight requests waiting for a matching `Reply` from the sidecar.
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    /// Capabilities announced at registration time (e.g. "<extension_name>.<callable_method>").
    ///
    /// TODO: not used for now
    capabilities: Vec<String>,
    /// Version string reported by the sidecar.
    ///
    /// TODO: not used for now
    version: String,
    /// The child process.
    child: Mutex<Child>,
}

impl Sidecar {
    /// Send a method call to the sidecar and wait for its reply.
    async fn call(&self, id: u64, method: &str, payload: &Value) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }

        let msg = CallMessage {
            kind: "call",
            id,
            method,
            payload,
        };
        let line = serde_json::to_string(&msg).map_err(|e| e.to_string())?
            + "
";
        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
        }

        // Block until the read loop receives the matching Reply and sends here.
        rx.await.map_err(|_| "sidecar dropped")?
    }
}

#[derive(Default)]
pub struct ExtensionHost {
    /// Map from extension id to its running sidecar.
    sidecars: RwLock<HashMap<String, Arc<Sidecar>>>,
    /// Monotonically increasing request id for calls.
    next_id: AtomicU64,
}

impl ExtensionHost {
    /// Find native extensions under `<appDataDir>/extensions/` and start them.
    pub async fn auto_discover(&self, app: &AppHandle) -> Result<(), String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app data dir: {e}"))?
            .join("extensions");
        if !dir.is_dir() {
            return Ok(());
        }

        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| format!("read extensions dir: {e}"))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            // exclude hidden dirs
            let hidden = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with('.'));
            if hidden || !path.is_dir() {
                continue;
            }

            let mf = match ExtensionManifest::load(&path) {
                Ok(mf) => mf,
                Err(e) => {
                    eprintln!("[extensions] {}: {e}", path.display());
                    continue;
                }
            };
            if let Err(e) = mf.validate() {
                eprintln!("[extensions] {}: {e}", path.display());
                continue;
            }
            if !mf.is_native() || !mf.support() {
                continue;
            }

            // File stem is the extension id. See `ExtensionHost.sidecars`.
            let ext_id = mf.id();
            let binary = path.join(&mf.entry);
            if !binary.is_file() {
                continue;
            }
            if self.sidecars.read().await.contains_key(&ext_id) {
                continue;
            }
            println!(
                "[extensions] launching sidecar: {} -> {}",
                ext_id,
                binary.display()
            );
            if let Err(e) = self.launch(app.clone(), ext_id.clone(), binary).await {
                eprintln!("[extensions] launch {ext_id}: {e}");
            }
        }

        Ok(())
    }

    /// Start a sidecar binary, wait for its `Register` message, and begin the
    /// read loop that routes replies and events back to the host / frontend.
    pub async fn launch(
        &self,
        app: AppHandle,
        ext_id: String,
        binary_path: std::path::PathBuf,
    ) -> Result<(), String> {
        // Spawn the child with piped stdio.
        let mut child = Command::new(binary_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn sidecar: {e}"))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Echo the sidecar's own stderr.
        let id = ext_id.clone();
        let mut lines = BufReader::new(stderr).lines();
        tauri::async_runtime::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[ext:{id}] {line}");
            }
        });

        // The very first stdout line from the sidecar must be a Register message.
        // TODO: ?
        let mut reader = BufReader::new(stdout).lines();
        let (capabilities, version) = loop {
            let line = reader
                .next_line()
                .await
                .map_err(|e| e.to_string())?
                .ok_or("sidecar exited before register")?;
            match serde_json::from_str::<ExtMessage>(&line) {
                Ok(ExtMessage::Register {
                    capabilities,
                    version,
                }) => break (capabilities, version),
                Ok(_) => return Err("expected register message".into()),
                Err(_) => eprintln!("[ext:{ext_id}] {line}"),
            }
        };

        // Build the sidecar handle and store it.
        let sidecar = Arc::new(Sidecar {
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            capabilities,
            version,
            child: Mutex::new(child),
        });
        self.sidecars
            .write()
            .await
            .insert(ext_id.clone(), sidecar.clone());

        // Spawn the background reader that consumes stdout lines forever.
        tauri::async_runtime::spawn(read_loop(app, ext_id, reader, sidecar));

        Ok(())
    }

    /// Public entry used by the Tauri command [`native_call`].
    ///
    /// Looks up the target sidecar and forwards the method call to it.
    pub async fn call(&self, ext_id: &str, method: &str, payload: Value) -> Result<Value, String> {
        let sidecars = self.sidecars.read().await;
        let sidecar = sidecars
            .get(ext_id)
            .ok_or_else(|| format!("backend extension not found: {ext_id}"))?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        sidecar.call(id, method, &payload).await
    }

    /// Drop a running sidecar.
    pub async fn shutdown(&self, ext_id: &str) {
        let sidecar = self.sidecars.write().await.remove(ext_id);
        let Some(sidecar) = sidecar else {
            return;
        };
        let _ = sidecar.child.lock().await.kill().await;
    }
}

async fn read_loop(
    app: AppHandle,
    ext_id: String,
    mut reader: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    sidecar: Arc<Sidecar>,
) {
    while let Ok(Some(line)) = reader.next_line().await {
        let msg: ExtMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(_) => {
                eprintln!("[ext:{ext_id}] {line}");
                continue;
            }
        };

        match msg {
            // A reply to a previous call: resolve the matching pending request.
            ExtMessage::Reply { id, result, error } => {
                let mut pending = sidecar.pending.lock().await;
                if let Some(tx) = pending.remove(&id) {
                    let res = match error {
                        Some(e) => Err(e),
                        None => Ok(result.unwrap_or(Value::Null)),
                    };
                    let _ = tx.send(res);
                }
            }
            // A one-way event: forward it to the frontend on a typed channel.
            ExtMessage::Event { event, payload } => {
                let _ = app.emit(&format!("ext:{ext_id}:{event}"), payload);
            }
            _ => {}
        }
    }

    eprintln!("[ext:{ext_id}] sidecar exited");
}

/// Call an backend extension method.
#[tauri::command]
pub async fn native_call(
    host: State<'_, ExtensionHost>,
    ext_id: String,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    host.call(&ext_id, &method, payload).await
}
