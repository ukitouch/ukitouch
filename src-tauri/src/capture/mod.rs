//! Screen capture: a full-screen pixel source that reports what changed.
//!
//! The shape, in one line: grab the whole screen, compare against the previous
//! frame, and hand only the changed rectangles to the caller..
//!
//! TODO: One backends exists today (`x11`). Windows (WGC) and Android (MediaProjection
//! + ImageReader) are the other two, and they plug in behind the same trait.

use serde::{Deserialize, Serialize};

/// A changed rectangle, in screen pixels.
///
/// Coordinates are relative to the captured screen's top-left, and the pixel
/// data that accompanies one is row-major over exactly `width` x `height`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct Damage {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// A screen's dimensions and the byte layout of the pixels we hand out.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ScreenInfo {
    pub width: u16,
    pub height: u16,
    /// Always `"rgba"`.
    pub format: &'static str,
}

/// Error info for why capture failed
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureError {
    /// The user refused the capture request.
    Denied,
    /// The user dismissed the capture request without deciding.
    Cancelled,
    /// This platform has no backend, or no screen to capture.
    Unsupported { reason: String },
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

/// What a caller can ask of a screen source.
///
/// These are requests, not guarantees: a backend maps them onto whatever its
/// platform offers and ignores the ones it cannot honor. On X11 the pointer is
/// absent from the root image, so `cursor` means blending the XFixes image in;
/// on Windows and Android the platform can include it for free.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureOptions {
    /// Include the pointer in the frames.
    pub cursor: bool,
}

/// A full-screen frame source.
///
/// Implementations own whatever the platform needs to read pixels, and are
/// responsible for turning the platform's native layout into RGBA.
pub trait CaptureBackend: Send {
    /// Screen dimensions and pixel layout.
    fn info(&self) -> ScreenInfo;

    /// Grab the screen and report what changed since the previous call.
    ///
    /// Returns `None` when nothing changed. The first call after construction
    /// always returns the full screen as one rectangle, so a caller that just
    /// connected has something to draw.
    ///
    /// Implementations should consult the platform's own "something was
    /// redrawn" signal before doing any pixel comparison.
    fn poll(&mut self) -> Result<Option<Vec<(Damage, Vec<u8>)>>, CaptureError>;

    /// Force the next `poll` to report the whole screen again.
    fn resync(&mut self);

    /// Apply options. Returning `true` means the screen's shape changed and
    /// callers that announced it before have to announce it again.
    fn configure(&mut self, _options: &CaptureOptions) -> bool {
        false
    }
}

pub mod bridge;
pub mod stream;

#[cfg(all(unix, not(target_os = "android")))]
pub mod x11;

/// Build the backend for this platform.
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
