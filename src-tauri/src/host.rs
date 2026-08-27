//! Host info for the hello handshake.
//! Exposed to the frontend as the `get_host_info` command; consumed by
//! src/core/hostinfo.ts.

use serde::Serialize;

#[derive(Serialize)]
pub struct HostInfo {
    /// Machine hostname (peer-facing display name), null when unavailable.
    pub name: Option<String>,
    /// Host platform: windows / macos / linux / android / ios.
    pub platform: String,
    /// Human-readable OS description, e.g. "Windows 11" / "Ubuntu 24.04 LTS".
    pub os: String,
}

#[tauri::command]
pub fn get_host_info() -> HostInfo {
    let name = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|s| !s.is_empty());
    let platform = std::env::consts::OS.to_string();
    let os = os_info::get().to_string();
    HostInfo {
        name,
        platform,
        os,
    }
}
