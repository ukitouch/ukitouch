//! Host / device type detection: which platform this build runs on.

/// Current platform, aligned with the frontend `HostPlatform` union
/// ("windows" | "linux" | "android").
#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}
