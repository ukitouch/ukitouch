//! Window fullscreen, forwarded to the local Android plugin
//! `OrientationPlugin` via the mobile plugin bridge.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, State};

/// Android plugin handle; absent elsewhere.
#[derive(Default)]
pub struct Orientation {
    #[cfg(target_os = "android")]
    handle: Option<tauri::plugin::PluginHandle<tauri::Wry>>,
}

#[allow(unused_variables)]
pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("orientation")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Orientation {
                handle: Some(
                    api.register_android_plugin("com.syome.ukitouch", "OrientationPlugin")?,
                ),
            });
            #[cfg(not(target_os = "android"))]
            app.manage(Orientation::default());
            Ok(())
        })
        .build()
}

/// Window background matching the page background.
pub fn window_color(dark: bool) -> tauri::window::Color {
    if dark {
        tauri::window::Color(0, 0, 0, 255)
    } else {
        tauri::window::Color(249, 250, 251, 255)
    }
}

/// Match the system bar icons and the window background to the app theme.
#[tauri::command]
pub async fn set_system_theme(
    app: tauri::AppHandle,
    state: State<'_, Orientation>,
    dark: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = &app;
        let handle = state
            .handle
            .as_ref()
            .ok_or("orientation plugin not registered")?;
        handle
            .run_mobile_plugin_async::<()>("theme", serde_json::json!({ "dark": dark }))
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        if let Some(window) = app.get_webview_window("main") {
            window
                .set_background_color(Some(window_color(dark)))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Hold the window in landscape with the system bars hidden, or hand control back.
#[tauri::command]
pub async fn set_fullscreen(state: State<'_, Orientation>, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = state
            .handle
            .as_ref()
            .ok_or("orientation plugin not registered")?;
        handle
            .run_mobile_plugin_async::<()>("fullscreen", serde_json::json!({ "enabled": enabled }))
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (state, enabled);
        Err("fullscreen is android-only".into())
    }
}
