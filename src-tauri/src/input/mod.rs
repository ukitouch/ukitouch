//! TODO: Currently only x11 implemented.

use serde::Deserialize;

/// A point on the source screen, in pixels.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Point {
    pub x: i16,
    pub y: i16,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    Back,
    Forward,
}

/// A synthesized input event, in screen pixels.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    /// Move the pointer to an absolute position on the root screen.
    Move { x: i16, y: i16 },
    /// Press or release a pointer button, at `at` when given.
    Button {
        at: Option<Point>,
        button: MouseButton,
        pressed: bool,
    },
    /// Wheel notches, positive towards the right and the bottom.
    Scroll { at: Option<Point>, dx: i32, dy: i32 },
    /// Press or release a physical key, named by its `KeyboardEvent.code`.
    Key { code: String, pressed: bool },
    /// Type a string.
    Text { text: String },
}

/// Where synthesized events go.
pub trait InputBackend: Send {
    /// Synthesize a batch of events in order.
    fn inject(&mut self, events: &[InputEvent]) -> Result<(), String>;

    /// Release everything this backend is holding down.
    fn release(&mut self);
}

/// Build the input backend for this platform.
pub fn create() -> Result<Box<dyn InputBackend>, String> {
    #[cfg(all(unix, not(target_os = "android")))]
    {
        return x11::X11Input::new().map(|b| Box::new(b) as Box<dyn InputBackend>);
    }
    #[cfg(not(all(unix, not(target_os = "android"))))]
    {
        Err(format!("no input backend for {}", std::env::consts::OS))
    }
}

#[cfg(all(unix, not(target_os = "android")))]
pub mod x11;

pub mod bridge;
