mod net;

use net::bridge::{
    net_configure, p2p_close_channel, p2p_connect, p2p_open_channel, p2p_send, sig_connect,
    sig_disconnect, sig_query, sig_send,
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
            usb_list_devices,
            usb_open_channel,
            usb_send,
            usb_close_channel,
            usb_listen_start,
            usb_listen_stop,
            get_platform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
