mod capture;
mod extensions;
mod host;
mod input;
mod net;
mod orientation;
#[cfg(target_os = "linux")]
mod pinch;
#[cfg(desktop)]
mod tray;

use capture::bridge::{
    capture_configure, capture_resync, capture_start, capture_stop, CaptureState,
};
use capture::stream::{start_screen_stream, stop_screen_stream, stream_configure, StreamState};
use extensions::{
    install_extension, list_installed_extensions, read_extension_script, uninstall_extension,
};
use host::get_host_info;
use input::bridge::{input_inject, input_release, input_start, input_stop, InputState};
use net::bridge::{
    net_configure, p2p_bind, p2p_cancel, p2p_close_channel, p2p_connect, p2p_open_channel,
    p2p_send, sig_connect, sig_disconnect, sig_query, sig_send,
};
use net::state::NetState;
use net::usb::{
    usb_close_channel, usb_list_devices, usb_listen_start, usb_listen_stop, usb_open_channel,
    usb_send,
};
use orientation::{init as orientation_plugin, set_fullscreen};
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(orientation_plugin())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(Arc::new(NetState::new(app.handle().clone())));
            app.manage(CaptureState::default());
            app.manage(StreamState::default());
            app.manage(InputState::default());

            #[cfg(target_os = "linux")]
            pinch::attach(app.handle());

            #[cfg(desktop)]
            {
                tray::init(app)?;
                // `--silent` starts straight into the tray, for autostart.
                if !std::env::args().any(|arg| arg == "--silent") {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window drops it to the tray. Quit via the tray menu.
            #[cfg(desktop)]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
            p2p_bind,
            p2p_close_channel,
            p2p_cancel,
            usb_list_devices,
            usb_open_channel,
            usb_send,
            usb_close_channel,
            usb_listen_start,
            usb_listen_stop,
            capture_start,
            capture_stop,
            capture_resync,
            capture_configure,
            start_screen_stream,
            stop_screen_stream,
            input_start,
            input_inject,
            input_release,
            input_stop,
            set_fullscreen,
            stream_configure,
            set_fullscreen,
            get_host_info,
            list_installed_extensions,
            read_extension_script,
            install_extension,
            uninstall_extension
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
