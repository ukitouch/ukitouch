use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use adb_client::server::ADBServer;
use adb_client::server_device::ADBServerDevice;
use adb_client::usb::ADBUSBDevice;
use adb_client::{ADBDeviceExt, Result as AdbResult};
use rusb::{Context, UsbContext};
use tokio::net::TcpStream;

use super::{FORWARD_PORT, REVERSE_PORT};
use crate::net::state::NetState;

const USB_POLL_INTERVAL: Duration = Duration::from_secs(2);

fn adb_server_running() -> bool {
    !ADBServer::default().should_start_server()
}

/// A connected adb device.
struct AdbDevice {
    vid: u16,
    pid: u16,
    serial: String,
}

/// Enumerate connected adb devices with their serials.
///
/// adb_client only reports vid/pid, the serial is read from the same physical device.
fn list_adb_devices() -> Result<Vec<AdbDevice>, String> {
    let known = adb_client::usb::find_all_connected_adb_devices().map_err(|e| e.to_string())?;
    let context = Context::new().map_err(|e| e.to_string())?;
    let mut devices = vec![];
    for device in context.devices().map_err(|e| e.to_string())?.iter() {
        let Ok(des) = device.device_descriptor() else {
            continue;
        };
        if !known
            .iter()
            .any(|d| d.vendor_id == des.vendor_id() && d.product_id == des.product_id())
        {
            continue;
        }
        let handle = device.open().map_err(|e| e.to_string())?;
        let serial = handle
            .read_serial_number_string_ascii(&des)
            .map_err(|e| e.to_string())?;
        if serial.is_empty() {
            return Err(format!(
                "adb device {:04x}:{:04x} has no serial number",
                des.vendor_id(),
                des.product_id()
            ));
        }
        devices.push(AdbDevice {
            vid: des.vendor_id(),
            pid: des.product_id(),
            serial,
        });
    }
    Ok(devices)
}

/// Backend for adb operations.
pub enum Adb {
    /// ADB server
    Server(ADBServerDevice),
    /// USB direct
    Usb(ADBUSBDevice),
}

impl Adb {
    fn new(d: &AdbDevice) -> AdbResult<Self> {
        if adb_server_running() {
            Ok(Self::Server(ADBServerDevice::new(d.serial.clone(), None)))
        } else {
            ADBUSBDevice::new(d.vid, d.pid).map(Self::Usb)
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
    let devices = list_adb_devices()?;
    let mut state = ns.usb.lock().map_err(|e| e.to_string())?;
    for d in devices {
        let device = match state.devices.entry(d.serial.clone()) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(Adb::new(&d).map_err(|e| e.to_string())?)
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
        let mut matching = list_adb_devices()?
            .into_iter()
            .filter(|d| d.vid == vendor_id && d.pid == product_id)
            .collect::<Vec<_>>();
        if matching.len() != 1 {
            return Err(format!(
                "expected one usb device for {:04x}:{:04x}, found {}",
                vendor_id,
                product_id,
                matching.len()
            ));
        }
        let target = matching.pop().unwrap();
        let mut state = ns_block.usb.lock().map_err(|e| e.to_string())?;
        let device = match state.devices.entry(target.serial.clone()) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(Adb::new(&target).map_err(|e| e.to_string())?)
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
        if let Ok(devices) = list_adb_devices() {
            let mut state = ns.usb.lock().unwrap();
            let serials: HashSet<&str> = devices.iter().map(|d| d.serial.as_str()).collect();
            state.devices.retain(|k, _| serials.contains(k.as_str()));
        }
        if let Err(e) = ensure_reverse(&ns) {
            eprintln!("[usb] device sync failed: {e}");
        }
    }
}
