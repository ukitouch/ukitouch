//! Window orientation lock, forwarded to the local Android plugin
//! `OrientationPlugin` via the mobile plugin bridge.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, State};

/// Android plugin handle; absent elsewhere.
#[derive(Default)]
pub struct Orientation {
    #[cfg(target_os = "android")]
    handle: Option<tauri::plugin::PluginHandle<tauri::Wry>>,
}

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

/// Lock the app window to `orientation`: `landscape`, `portrait` or `auto`.
#[tauri::command]
pub async fn lock_orientation(
    state: State<'_, Orientation>,
    orientation: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = state
            .handle
            .as_ref()
            .ok_or("orientation plugin not registered")?;
        handle
            .run_mobile_plugin_async::<()>(
                "lock",
                serde_json::json!({ "orientation": orientation }),
            )
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (state, orientation);
        Err("orientation lock is android-only".into())
    }
}
