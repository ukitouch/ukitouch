mod extensions;
mod host;
mod net;
mod orientation;
#[cfg(target_os = "linux")]
mod pinch;
#[cfg(desktop)]
mod tray;

use extensions::{
    host::{native_call, ExtensionHost},
    package::{
        install_extension, list_installed_extensions, read_extension_file, read_extension_manifest,
        uninstall_extension,
    },
};
use host::get_host_info;
use net::state::NetState;
use net::usb::{
    usb_close_channel, usb_list_devices, usb_listen_start, usb_listen_stop, usb_open_channel,
    usb_send,
};
use net::webrtc::bridge::{
    net_configure, sig_connect, sig_disconnect, sig_query, sig_send, webrtc_bind, webrtc_cancel,
    webrtc_close_all, webrtc_close_channel, webrtc_connect, webrtc_open_channel, webrtc_send,
};
use net::webrtc::pipe::{pipe_bind, pipe_unbind, PipeState};
use orientation::{init as orientation_plugin, set_fullscreen, set_system_theme};
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// Open a web page in the system browser.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http(s) urls can be opened".into());
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("open {url}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == "--silent") {
                tray::show_main(app);
            }
        }));
    #[cfg(not(desktop))]
    let builder = tauri::Builder::default();

    builder
        .plugin(orientation_plugin())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Arc::new(NetState::new(app.handle().clone())));
            app.manage(PipeState::default());
            app.manage(ExtensionHost::default());

            // native extensions
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let host = handle.state::<ExtensionHost>();
                if let Err(e) = host.auto_discover(&handle).await {
                    eprintln!("[extensions] auto discover failed: {e}");
                }
            });

            #[cfg(target_os = "linux")]
            pinch::attach(app.handle());

            #[cfg(desktop)]
            {
                tray::init(app)?;
                if let Some(window) = app.get_webview_window("main") {
                    let dark = window
                        .theme()
                        .map(|t| t == tauri::Theme::Dark)
                        .unwrap_or(false);
                    let _ = window.set_background_color(Some(orientation::window_color(dark)));
                }
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            #[cfg(desktop)]
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && !std::env::args().any(|arg| arg == "--silent")
            {
                let _ = webview.window().show();
                let _ = webview.window().set_focus();
            }
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
            webrtc_connect,
            webrtc_open_channel,
            webrtc_send,
            webrtc_bind,
            webrtc_close_channel,
            webrtc_close_all,
            webrtc_cancel,
            usb_list_devices,
            usb_open_channel,
            usb_send,
            usb_close_channel,
            usb_listen_start,
            usb_listen_stop,
            set_fullscreen,
            set_system_theme,
            get_host_info,
            list_installed_extensions,
            read_extension_manifest,
            read_extension_file,
            install_extension,
            uninstall_extension,
            native_call,
            pipe_bind,
            pipe_unbind,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
