#[cfg(not(target_os = "android"))]
mod adb;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::{net::TcpListener, task::JoinHandle, time::timeout};

#[cfg(not(target_os = "android"))]
use self::adb::{dial_forward, ensure_reverse, usb_poll_loop, Adb};

use crate::net::state::NetState;

const REVERSE_PORT: u16 = 21700;
const FORWARD_PORT: u16 = 21701;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);

pub struct UsbState {
    /// (vendor_id, product_id) -> adb connection
    #[cfg(not(target_os = "android"))]
    pub devices: HashMap<(u16, u16), Adb>,
    /// channel_id -> channel
    channels: HashMap<u64, Arc<UsbChannel>>,
    next_channel_id: u64,
    pub listener_handle: Option<JoinHandle<()>>,
    /// handle to check for new devices
    #[cfg(not(target_os = "android"))]
    pub poll_handle: Option<JoinHandle<()>>,
}

impl Default for UsbState {
    fn default() -> Self {
        Self {
            #[cfg(not(target_os = "android"))]
            devices: HashMap::new(),
            channels: HashMap::new(),
            next_channel_id: 0,
            listener_handle: None,
            #[cfg(not(target_os = "android"))]
            poll_handle: None,
        }
    }
}

/// One established channel.
struct UsbChannel {
    write: tokio::sync::Mutex<OwnedWriteHalf>,
    /// Host port of this channel's forward tunnel, removed on close.
    forward_port: Option<u16>,
}

/// Remove the forward tunnel of `port`.
fn remove_forward(ns: &Arc<NetState>, port: u16) {
    #[cfg(target_os = "android")]
    let _ = (ns, port);
    #[cfg(not(target_os = "android"))]
    for dev in ns.usb.lock().unwrap().devices.values() {
        let _ = dev.forward_remove(&format!("tcp:{}", port));
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub description: String,
}

#[tauri::command]
pub fn usb_list_devices() -> Result<Vec<DeviceInfo>, String> {
    #[cfg(target_os = "android")]
    {
        // nothing to enumerate on the phone, it dials the desktop directly
        return Ok(Vec::new());
    }
    #[cfg(not(target_os = "android"))]
    adb_client::usb::find_all_connected_adb_devices()
        .map(|devices| {
            devices
                .into_iter()
                .map(|d| DeviceInfo {
                    vendor_id: d.vendor_id,
                    product_id: d.product_id,
                    description: d.device_description,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}

/// Open a channel, returns the channel id for usb_send and usb_close_channel.
///
/// vendor_id and product_id are not required for Android.
#[tauri::command]
pub async fn usb_open_channel(
    state: State<'_, Arc<NetState>>,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
    label: String,
) -> Result<u64, String> {
    let ns: Arc<NetState> = state.inner().clone();

    #[cfg(not(target_os = "android"))]
    let (mut stream, forward_port) = {
        let (vendor_id, product_id) = vendor_id
            .zip(product_id)
            .ok_or_else(|| "vendor_id and product_id are required".to_string())?;

        dial_forward(&ns, vendor_id, product_id).await?
    };
    #[cfg(target_os = "android")]
    let (mut stream, forward_port) = {
        let _ = (vendor_id, product_id);
        dial_reverse(&ns, &label).await?
    };

    // send the label, wait for the peer's ack
    if let Err(e) = handshake(&mut stream, &label).await {
        if let Some(port) = forward_port {
            remove_forward(&ns, port);
        }
        return Err(e);
    }

    let (read, write) = stream.into_split();

    let channel_id = {
        let mut usb = ns.usb.lock().map_err(|e| e.to_string())?;
        let id = usb.next_channel_id;
        usb.next_channel_id += 1;
        id
    };
    let ch = Arc::new(UsbChannel {
        write: tokio::sync::Mutex::new(write),
        forward_port,
    });
    ns.usb
        .lock()
        .map_err(|e| e.to_string())?
        .channels
        .insert(channel_id, ch);

    let app = ns.app.clone();
    tokio::spawn(read_loop(app, ns.clone(), channel_id, read, forward_port));

    Ok(channel_id)
}

#[tauri::command]
pub async fn usb_close_channel(
    state: State<'_, Arc<NetState>>,
    channel_id: u64,
) -> Result<(), String> {
    let ns: Arc<NetState> = state.inner().clone();
    let ch = {
        let mut usb = ns.usb.lock().map_err(|e| e.to_string())?;
        usb.channels
            .remove(&channel_id)
            .ok_or("channel not found".to_string())?
    };
    if let Some(port) = ch.forward_port {
        remove_forward(&ns, port);
    }
    let _ = ch.write.lock().await.shutdown().await;
    let _ = ns
        .app
        .emit("usb-channel-close", json!({ "channel_id": channel_id }));
    Ok(())
}

#[tauri::command]
pub async fn usb_listen_start(
    app: AppHandle,
    state: State<'_, Arc<NetState>>,
) -> Result<(), String> {
    let ns: Arc<NetState> = state.inner().clone();

    {
        let usb = ns.usb.lock().map_err(|e| e.to_string())?;
        if usb.listener_handle.is_some() {
            // TODO: restart listener
            return Err("Already listening".to_string());
        }
    }

    #[cfg(not(target_os = "android"))]
    let bind_addr = format!("127.0.0.1:{}", REVERSE_PORT);

    #[cfg(target_os = "android")]
    let bind_addr = format!("127.0.0.1:{}", FORWARD_PORT);

    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| e.to_string())?;

    // Desktop's listen is a loop that check for new devices' plug in, and open a reverse tunnel for them.
    #[cfg(not(target_os = "android"))]
    if let Err(e) = ensure_reverse(&ns) {
        drop(listener);
        return Err(e);
    }

    let handle = tokio::spawn(usb_listen_loop(app, ns.clone(), listener));

    #[cfg(not(target_os = "android"))]
    let poll = tokio::spawn(usb_poll_loop(ns.clone()));

    {
        let mut usb = ns.usb.lock().map_err(|e| e.to_string())?;
        usb.listener_handle = Some(handle);
        #[cfg(not(target_os = "android"))]
        {
            usb.poll_handle = Some(poll);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn usb_listen_stop(state: State<'_, Arc<NetState>>) -> Result<(), String> {
    let ns: Arc<NetState> = state.inner().clone();
    let mut usb = ns.usb.lock().map_err(|e| e.to_string())?;

    if usb.listener_handle.is_none() {
        return Err("Not listening".to_string());
    }

    if let Some(handle) = usb.listener_handle.take() {
        handle.abort();
    }

    #[cfg(not(target_os = "android"))]
    if let Some(poll) = usb.poll_handle.take() {
        poll.abort();
    }

    #[cfg(not(target_os = "android"))]
    for dev in usb.devices.values() {
        let _ = dev.reverse_remove(&format!("tcp:{}", REVERSE_PORT));
    }

    Ok(())
}

/// Send data on a channel.
#[tauri::command]
pub async fn usb_send(
    state: State<'_, Arc<NetState>>,
    channel_id: u64,
    data: Vec<u8>,
) -> Result<(), String> {
    let ns: Arc<NetState> = state.inner().clone();
    let ch = {
        let usb = ns.usb.lock().map_err(|e| e.to_string())?;
        usb.channels
            .get(&channel_id)
            .cloned()
            .ok_or("channel not found".to_string())?
    };
    let mut write = ch.write.lock().await;
    write.write_all(&data).await.map_err(|e| e.to_string())
}

/// Dial the reverse address.
#[cfg(target_os = "android")]
async fn dial_reverse(
    _ns: &Arc<NetState>,
    _label: &str,
) -> Result<(TcpStream, Option<u16>), String> {
    let stream = TcpStream::connect(format!("127.0.0.1:{}", REVERSE_PORT))
        .await
        .map_err(|_| "the other peer is not accepting USB connections".to_string())?;
    Ok((stream, None))
}

async fn usb_listen_loop(app: AppHandle, ns: Arc<NetState>, listener: TcpListener) {
    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                eprintln!("[usb] Received connection: {}", addr);

                let app = app.clone();
                tokio::spawn(handle_accept(app, ns.clone(), stream));
            }
            Err(e) => {
                eprintln!("[listen] Accept failed: {}", e);
                break;
            }
        }
    }
}

/// Handshake, register as a channel, and read until the connection ends.
async fn handle_accept(app: AppHandle, ns: Arc<NetState>, mut stream: TcpStream) {
    let label = match timeout(HANDSHAKE_TIMEOUT, read_label(&mut stream)).await {
        Ok(Ok(label)) => label,
        _ => return,
    };
    if stream.write_all(b"\n").await.is_err() {
        return;
    }
    let (read, write) = stream.into_split();

    let channel_id = {
        let mut usb = ns.usb.lock().unwrap();
        let id = usb.next_channel_id;
        usb.next_channel_id += 1;
        id
    };
    let ch = Arc::new(UsbChannel {
        write: tokio::sync::Mutex::new(write),
        forward_port: None,
    });
    ns.usb.lock().unwrap().channels.insert(channel_id, ch);

    let _ = app.emit(
        "usb-channel-open",
        json!({ "channel_id": channel_id, "label": label }),
    );
    read_loop(app, ns, channel_id, read, None).await;
}

/// Send `{label}\n`, wait for the peer's `\n` ack.
async fn handshake(stream: &mut TcpStream, label: &str) -> Result<(), String> {
    let ack = timeout(HANDSHAKE_TIMEOUT, async {
        stream.write_all(format!("{label}\n").as_bytes()).await?;
        let mut buf = [0u8; 1];
        stream.read_exact(&mut buf).await?;
        Ok::<_, std::io::Error>(buf[0])
    })
    .await;
    match ack {
        Ok(Ok(b'\n')) => Ok(()),
        _ => Err("the other peer is not accepting USB connections".into()),
    }
}

/// Read the dialer's `{label}\n` line.
async fn read_label(stream: &mut TcpStream) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match stream.read(&mut byte).await {
            Ok(0) | Err(_) => return Err("label read failed".into()),
            Ok(_) => {
                if byte[0] == b'\n' {
                    return Ok(String::from_utf8_lossy(&buf).into_owned());
                }
                buf.push(byte[0]);
            }
        }
    }
}

/// Loop that emit `usb-channel-data` per chunk, emit `usb-channel-close` on EOF.
async fn read_loop(
    app: AppHandle,
    ns: Arc<NetState>,
    channel_id: u64,
    mut read: OwnedReadHalf,
    forward_port: Option<u16>,
) {
    let mut buf = [0u8; 8192];
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

    if let Some(port) = forward_port {
        remove_forward(&ns, port);
    }

    let closed = ns
        .usb
        .lock()
        .unwrap()
        .channels
        .remove(&channel_id)
        .is_some();
    if closed {
        let _ = app.emit("usb-channel-close", json!({ "channel_id": channel_id }));
    }
}
