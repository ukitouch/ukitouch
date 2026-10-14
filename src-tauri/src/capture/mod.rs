//! TODO: Currently only x11 implemented.

use serde::{Deserialize, Serialize};

/// A changed rectangle, in screen pixels.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct Damage {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// A screen's dimensions and the byte layout of the pixels.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ScreenInfo {
    pub width: u16,
    pub height: u16,
    /// Always `"rgba"`.
    pub format: &'static str,
}

/// Error info for why capture failed.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureError {
    Denied,
    Cancelled,
    /// this platform has no backend
    Unsupported {
        reason: String,
    },
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Denied => write!(f, "screen capture was denied"),
            Self::Cancelled => write!(f, "screen capture was cancelled"),
            Self::Unsupported { reason } => write!(f, "screen capture unsupported: {reason}"),
        }
    }
}

impl std::error::Error for CaptureError {}

/// How the pointer appears in the stream.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cursor {
    #[default]
    Off,
    /// Drawn into the frames' pixels.
    Composite,
    /// The pointer's own image, sent for the peer to draw.
    Raw,
}

/// Capture options to the screen collector.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureOptions {
    /// How the pointer appears in the stream.
    pub cursor: Cursor,
}

/// The pointer's own image.
pub struct CursorImage {
    pub width: u16,
    pub height: u16,
    /// The pointer's own position within the image.
    pub xhot: u16,
    pub yhot: u16,
    /// Row-major premultiplied RGBA.
    pub pixels: Vec<u8>,
}

/// Screen collector's backend.
pub trait CaptureBackend: Send {
    /// Screen dimensions and pixel layout.
    fn info(&self) -> ScreenInfo;

    /// Grab the screen and report what changed since the previous call.
    ///
    /// Returns `None` when nothing changed.
    ///
    /// Implementations should consult the platform's own "something was
    /// redrawn" signal before doing any pixel comparison.
    fn poll(&mut self) -> Result<Option<Vec<(Damage, Vec<u8>)>>, CaptureError>;

    /// Force the next `poll` to report the whole screen again.
    fn resync(&mut self);

    /// Apply options. Returning `true` means the screen's shape changed.
    fn configure(&mut self, _options: &CaptureOptions) -> bool {
        false
    }

    /// The pointer's own image, when the backend was asked to report it.
    ///
    /// Returns `Some` only when the image changed since the last call.
    fn cursor_image(&mut self) -> Result<Option<CursorImage>, CaptureError> {
        Ok(None)
    }
}

pub mod bridge;
pub mod stream;

#[cfg(all(unix, not(target_os = "android")))]
pub mod x11;

/// Build the capturing backend for this platform.
pub fn create() -> Result<Box<dyn CaptureBackend>, CaptureError> {
    #[cfg(all(unix, not(target_os = "android")))]
    {
        return x11::X11Capture::new().map(|b| Box::new(b) as Box<dyn CaptureBackend>);
    }
    #[cfg(not(all(unix, not(target_os = "android"))))]
    {
        Err(CaptureError::Unsupported {
            reason: format!("no capture backend for {}", std::env::consts::OS),
        })
    }
}
