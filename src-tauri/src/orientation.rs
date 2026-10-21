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
                    api.register_android_plugin("com.syome.yatouch", "OrientationPlugin")?,
                ),
            });
            #[cfg(not(target_os = "android"))]
            app.manage(Orientation::default());
            Ok(())
        })
        .build()
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
