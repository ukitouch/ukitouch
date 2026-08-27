mod host;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![host::get_host_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
