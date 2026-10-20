//! TODO: may replace with the upstream switch once it exists: WebKitGTK
//! `enable-pinch-zoom-gesture` or a wry option (tauri-apps/wry#544,
//! tauri-apps/tauri#13115).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Event the page listens on.
pub const EVENT: &str = "yatouch://pinch";

/// One gesture frame, pushed to the page.
#[derive(Clone, Serialize)]
struct Frame {
    phase: &'static str,
    /// Cumulative scale since the gesture began.
    scale: f64,
    // Centre of the pinch, in CSS pixels of the page.
    x: f64,
    y: f64,
}

/// The widget keeps its handlers for the life of the webview.
#[cfg(target_os = "linux")]
pub fn attach(app: &AppHandle) {
    use gtk::glib::gobject_ffi as gobject;
    use gtk::glib::translate::from_glib_none;
    use gtk::prelude::*;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let handle = app.clone();
    let _ = window.with_webview(move |webview| {
        let widget: gtk::Widget = webview.inner().upcast();
        unsafe {
            let raw = gobject::g_object_get_data(
                widget.as_ptr() as *mut gobject::GObject,
                c"wk-view-zoom-gesture".as_ptr(),
            );
            if raw.is_null() {
                return;
            }

            // Drop WebKit's own begin/scale-changed/end that drive the view gesture controller.
            gobject::g_signal_handlers_disconnect_matched(
                raw as *mut gobject::GObject,
                gobject::G_SIGNAL_MATCH_DATA,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                widget.as_ptr() as *mut _,
            );
            let gesture: gtk::Gesture = from_glib_none(raw as *mut gtk::ffi::GtkGesture);
            let Ok(zoom) = gesture.downcast::<gtk::GestureZoom>() else {
                return;
            };

            // Claiming denies the gestures WebKit groups with this one.
            let begin = handle.clone();
            zoom.connect_begin(move |gesture, _| {
                gesture.set_state(gtk::EventSequenceState::Claimed);
                if let Some((x, y)) = gesture.bounding_box_center() {
                    let _ = begin.emit(
                        EVENT,
                        Frame {
                            phase: "start",
                            scale: 1.0,
                            x,
                            y,
                        },
                    );
                }
            });
            let changed = handle.clone();
            zoom.connect_scale_changed(move |gesture, scale| {
                gesture.set_state(gtk::EventSequenceState::Claimed);
                if let Some((x, y)) = gesture.bounding_box_center() {
                    let _ = changed.emit(
                        EVENT,
                        Frame {
                            phase: "move",
                            scale,
                            x,
                            y,
                        },
                    );
                }
            });
            zoom.connect_end(move |_, _| {
                let _ = handle.emit(
                    EVENT,
                    Frame {
                        phase: "end",
                        scale: 1.0,
                        x: 0.0,
                        y: 0.0,
                    },
                );
            });
        }
    });
}
