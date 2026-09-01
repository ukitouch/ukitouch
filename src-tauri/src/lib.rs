mod extensions;
mod host;
mod net;

use extensions::{
    install_extension, list_installed_extensions, read_extension_file, uninstall_extension,
};
use host::get_host_info;
use net::bridge::{
    net_configure, p2p_cancel, p2p_close_channel, p2p_connect, p2p_open_channel, p2p_send,
    sig_connect, sig_disconnect, sig_query, sig_send,
};
use net::host::get_platform;
use net::state::NetState;
use net::usb::{
    usb_close_channel, usb_list_devices, usb_listen_start, usb_listen_stop, usb_open_channel,
    usb_send,
};
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(Arc::new(NetState::new(app.handle().clone())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            net_configure,
            sig_connect,
            sig_disconnect,
            sig_send,
            sig_query,
            p2p_connect,
            p2p_open_channel,
            p2p_send,
            p2p_close_channel,
            p2p_cancel,
            usb_list_devices,
            usb_open_channel,
            usb_send,
            usb_close_channel,
            usb_listen_start,
            usb_listen_stop,
            get_platform,
            get_host_info,
            list_installed_extensions,
            read_extension_file,
            install_extension,
            uninstall_extension
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
