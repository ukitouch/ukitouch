use std::sync::Arc;
use std::time::Duration;

use adb_client::server::ADBServer;
use adb_client::server_device::ADBServerDevice;
use adb_client::usb::ADBUSBDevice;
use adb_client::{ADBDeviceExt, Result as AdbResult};
use tokio::net::TcpStream;

use super::{FORWARD_PORT, REVERSE_PORT};
use crate::net::state::NetState;

const USB_POLL_INTERVAL: Duration = Duration::from_secs(2);

fn adb_server_running() -> bool {
    !ADBServer::default().should_start_server()
}

/// Backend for adb operations.
pub enum Adb {
    /// ADB server
    Server(ADBServerDevice),
    /// USB direct
    Usb(ADBUSBDevice),
}

impl Adb {
    fn new(vendor_id: u16, product_id: u16) -> AdbResult<Self> {
        if adb_server_running() {
            Ok(Self::Server(ADBServerDevice::autodetect(None)))
        } else {
            ADBUSBDevice::new(vendor_id, product_id).map(Self::Usb)
        }
    }

    fn reverse(&self, remote: &str, local: &str) -> AdbResult<()> {
        match self {
            Self::Server(d) => d.reverse(remote.to_string(), local.to_string()),
            Self::Usb(d) => d.reverse(remote, local),
        }
    }

    pub(crate) fn reverse_remove(&self, remote: &str) -> AdbResult<()> {
        match self {
            Self::Server(d) => d.reverse_remove(remote.to_string()),
            Self::Usb(d) => d.reverse_remove(remote),
        }
    }

    fn forward(&self, local: &str, remote: &str) -> AdbResult<String> {
        match self {
            Self::Server(d) => d.forward(local.to_string(), remote.to_string()),
            Self::Usb(d) => d.forward(local, remote),
        }
    }

    pub(crate) fn forward_remove(&self, local: &str) -> AdbResult<()> {
        match self {
            Self::Server(d) => d.forward_remove(local.to_string()),
            Self::Usb(d) => d.forward_remove(local),
        }
    }
}

/// Ensure the reverse tunnel exists on every pluged-in device.
pub fn ensure_reverse(ns: &Arc<NetState>) -> Result<(), String> {
    let connected = adb_client::usb::find_all_connected_adb_devices().map_err(|e| e.to_string())?;
    let mut state = ns.usb.lock().map_err(|e| e.to_string())?;
    for d in connected {
        let device = match state.devices.entry((d.vendor_id, d.product_id)) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(Adb::new(d.vendor_id, d.product_id).map_err(|e| e.to_string())?)
            }
        };
        device
            .reverse(
                &format!("tcp:{}", REVERSE_PORT),
                &format!("tcp:{}", REVERSE_PORT),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Set up the adb tunnels, connect to the forward address.
pub async fn dial_forward(
    ns: &Arc<NetState>,
    vendor_id: u16,
    product_id: u16,
) -> Result<(TcpStream, Option<u16>), String> {
    // Reuse or create the adb connection, then set up this channel's tunnels.
    let ns_block = ns.clone();
    let forward_port = tokio::task::spawn_blocking(move || {
        let mut state = ns_block.usb.lock().map_err(|e| e.to_string())?;
        let device = match state.devices.entry((vendor_id, product_id)) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(Adb::new(vendor_id, product_id).map_err(|e| e.to_string())?)
            }
        };

        // forward
        let forward_local = device
            .forward(&format!("tcp:{}", FORWARD_PORT), "tcp:0")
            .map_err(|e| e.to_string())?;

        forward_local
            .strip_prefix("tcp:")
            .unwrap_or("")
            .parse()
            .map_err(|_| format!("bad forward address: {forward_local}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    let stream = TcpStream::connect(format!("127.0.0.1:{}", forward_port))
        .await
        .map_err(|_| "the other peer is not accepting USB connections".to_string())?;
    Ok((stream, Some(forward_port)))
}

/// Keep the device map and reverse tunnels in sync while the listener is up.
pub async fn usb_poll_loop(ns: Arc<NetState>) {
    let mut interval = tokio::time::interval(USB_POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let Ok(connected) = adb_client::usb::find_all_connected_adb_devices() else {
            continue;
        };
        {
            let mut state = ns.usb.lock().unwrap();
            state
                .devices
                .retain(|k, _| connected.iter().any(|d| &(d.vendor_id, d.product_id) == k));
        }
        if let Err(e) = ensure_reverse(&ns) {
            eprintln!("[usb] device sync failed: {e}");
        }
    }
}
