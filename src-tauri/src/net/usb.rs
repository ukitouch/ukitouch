use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::sync::Arc;

use adb_client::server::{ADBServer, DeviceShort};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};

use super::state::NetState;

const ADB_SERVER_ADDR: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 5037);
/// Device-side gateway port the app's listener binds (constant for now).
const GATEWAY_PORT: u16 = 21000;

/// List devices currently connected to the adb server.
pub fn list_devices() -> Result<Vec<DeviceShort>, String> {
    let mut server = ADBServer::new(ADB_SERVER_ADDR);
    server.devices().map_err(|e| e.to_string())
}

/// Serializable device shape for the frontend.
#[derive(Serialize)]
pub struct UsbDevice {
    pub serial: String,
    pub state: String,
}

/// Frontend-facing command: list devices reachable via adb.
#[tauri::command]
pub fn usb_list_devices() -> Result<Vec<UsbDevice>, String> {
    Ok(list_devices()?
        .into_iter()
        .map(|d| UsbDevice {
            serial: d.identifier,
            state: d.state.to_string(),
        })
        .collect())
}

#[derive(Default)]
pub struct UsbInner {
    pub channels: HashMap<u64, Arc<UsbChannel>>,
    next_channel_id: u64,
    /// Sender used to stop the gateway listener, if running.
    pub listen_tx: Option<tokio::sync::watch::Sender<bool>>,
}

pub struct UsbChannel {
    pub write: tokio::sync::Mutex<OwnedWriteHalf>,
}

/// Grab a free loopback port, then release it (the forward re-claims it).
fn free_host_port() -> Result<u16, String> {
    let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

async fn read_loop(app: AppHandle, state: Arc<NetState>, channel_id: u64, mut read: OwnedReadHalf) {
    let mut buf = vec![0u8; 8192];
    loop {
        match read.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let _ = app.emit(
                    "usb-channel-data",
                    json!({ "channel_id": channel_id, "data": B64.encode(&buf[..n]) }),
                );
            }
        }
    }
    let _ = app.emit("usb-channel-close", json!({ "channel_id": channel_id }));
    state.usb.lock().unwrap().channels.remove(&channel_id);
}

/// Open a channel to `serial` via `adb forward` + connect.
#[tauri::command]
pub async fn usb_open_channel(
    state: State<'_, Arc<NetState>>,
    serial: String,
    label: String,
) -> Result<u64, String> {
    let serial_for_forward = serial.clone();
    let host_port = tauri::async_runtime::spawn_blocking(move || {
        let mut server = ADBServer::new(ADB_SERVER_ADDR);
        let mut device = server
            .get_device_by_name(&serial_for_forward)
            .map_err(|e| e.to_string())?;
        let host_port = free_host_port()?;
        device
            .forward(format!("tcp:{GATEWAY_PORT}"), format!("tcp:{host_port}"))
            .map_err(|e| e.to_string())?;
        Ok::<u16, String>(host_port)
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut stream = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(SocketAddrV4::new(Ipv4Addr::LOCALHOST, host_port)),
    )
    .await
    .map_err(|_| "connect timed out")?
    .map_err(|e| e.to_string())?;
    // Send the label, then wait for the phone's ack.
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.write_all(format!("{label}\n").as_bytes()),
    )
    .await
    .map_err(|_| "write timed out")?
    .map_err(|e| e.to_string())?;
    let mut ack = [0u8; 1];
    let n = tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut ack))
        .await
        .map_err(|_| "handshake ack timed out")?
        .map_err(|e| e.to_string())?;
    if n == 0 {
        // The device dropped the connection without acking
        return Err("handshake failed: device not accepting USB connections".into());
    }
    let (read, write) = stream.into_split();

    let channel_id = {
        let mut inner = state.usb.lock().unwrap();
        let id = inner.next_channel_id;
        inner.next_channel_id += 1;
        id
    };
    let channel = Arc::new(UsbChannel {
        write: tokio::sync::Mutex::new(write),
    });
    state
        .usb
        .lock()
        .unwrap()
        .channels
        .insert(channel_id, channel);

    let app2 = state.app.clone();
    let net = state.inner().clone();
    tauri::async_runtime::spawn(read_loop(app2, net, channel_id, read));

    Ok(channel_id)
}

/// Send bytes on a USB channel.
#[tauri::command]
pub async fn usb_send(
    state: State<'_, Arc<NetState>>,
    channel_id: u64,
    data: Vec<u8>,
) -> Result<(), String> {
    let channel = state
        .usb
        .lock()
        .unwrap()
        .channels
        .get(&channel_id)
        .cloned()
        .ok_or("channel not found")?;
    let mut guard = channel.write.lock().await;
    guard.write_all(&data).await.map_err(|e| e.to_string())
}

/// Close a USB channel.
#[tauri::command]
pub async fn usb_close_channel(
    app: AppHandle,
    state: State<'_, Arc<NetState>>,
    channel_id: u64,
) -> Result<(), String> {
    let channel = state
        .usb
        .lock()
        .unwrap()
        .channels
        .remove(&channel_id)
        .ok_or("channel not found")?;
    let _ = channel.write.lock().await.shutdown().await;
    let _ = app.emit("usb-channel-close", json!({ "channel_id": channel_id }));
    Ok(())
}

/// Start the device-side gateway listener on `GATEWAY_PORT`. Idempotent.
#[tauri::command]
pub async fn usb_listen_start(
    app: AppHandle,
    state: State<'_, Arc<NetState>>,
) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, GATEWAY_PORT))
        .await
        .map_err(|e| e.to_string())?;
    let mut inner = state.usb.lock().unwrap();
    if inner.listen_tx.is_some() {
        return Ok(());
    }
    let (tx, rx) = tokio::sync::watch::channel(true);
    inner.listen_tx = Some(tx);
    drop(inner);

    let net = state.inner().clone();
    tauri::async_runtime::spawn(accept_loop(app, net, listener, rx));
    Ok(())
}

/// Stop the device-side gateway listener, if running.
#[tauri::command]
pub async fn usb_listen_stop(state: State<'_, Arc<NetState>>) -> Result<(), String> {
    let tx = state.usb.lock().unwrap().listen_tx.take();
    if let Some(tx) = tx {
        let _ = tx.send(false);
    }
    Ok(())
}

async fn accept_loop(
    app: AppHandle,
    state: Arc<NetState>,
    listener: tokio::net::TcpListener,
    mut rx: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = rx.changed() => {
                if !*rx.borrow() {
                    break;
                }
            }
            res = listener.accept() => {
                let (stream, _) = match res {
                    Ok(x) => x,
                    Err(_) => break,
                };
                let app2 = app.clone();
                let net = state.clone();
                tauri::async_runtime::spawn(handle_accept(app2, net, stream));
            }
        }
    }
}

/// Register an accepted connection as an incoming channel, routed by label.
async fn handle_accept(app: AppHandle, state: Arc<NetState>, mut stream: tokio::net::TcpStream) {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match stream.read(&mut byte).await {
            Ok(0) => return,
            Ok(_) => {
                if byte[0] == b'\n' {
                    break;
                }
                buf.push(byte[0]);
            }
            Err(_) => return,
        }
    }
    let label = String::from_utf8_lossy(&buf).to_string();
    // Ack the desktop's handshake so the forward tunnel is exercised bidirectionally.
    let _ = stream.write_all(b"\n").await;
    let (read, write) = stream.into_split();

    let channel_id = {
        let inner = state.usb.lock().unwrap();
        inner.next_channel_id
    };
    {
        let mut inner = state.usb.lock().unwrap();
        inner.next_channel_id += 1;
    }
    state.usb.lock().unwrap().channels.insert(
        channel_id,
        Arc::new(UsbChannel {
            write: tokio::sync::Mutex::new(write),
        }),
    );
    let _ = app.emit(
        "usb-channel-open",
        json!({ "channel_id": channel_id, "label": label }),
    );

    let app2 = app.clone();
    let net = state.clone();
    tauri::async_runtime::spawn(read_loop(app2, net, channel_id, read));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_lists_devices() {
        match list_devices() {
            Ok(devices) => println!("adb devices: {devices:?}"),
            Err(e) => panic!("scan failed: {e}"),
        }
    }

    #[test]
    fn forward_establishes() {
        let devices = list_devices().expect("scan");
        if devices.is_empty() {
            println!("no device connected; skipping");
            return;
        }
        let serial = devices[0].identifier.clone();
        let host_port = free_host_port().expect("free port");
        let mut server = ADBServer::new(ADB_SERVER_ADDR);
        let mut device = server.get_device_by_name(&serial).expect("get device");
        device
            .forward(format!("tcp:{GATEWAY_PORT}"), format!("tcp:{host_port}"))
            .expect("forward");
        println!("forward ok: host {host_port} -> device tcp:{GATEWAY_PORT}");
        match std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, host_port)) {
            Ok(_) => println!("connect succeeded (device may be listening)"),
            Err(e) => println!("connect failed (no listener yet): {e}"),
        }
    }
}
