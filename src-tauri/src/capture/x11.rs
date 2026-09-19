//! X11 capture via MIT-SHM, using the DAMAGE extension as a change trigger.

use x11rb::connection::Connection;
use x11rb::protocol::damage::{self, ConnectionExt as _};
use x11rb::protocol::shm::ConnectionExt as _;
use x11rb::protocol::xfixes::{self, ConnectionExt as _};
use x11rb::protocol::xproto::ImageFormat;
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use super::{CaptureBackend, CaptureError, CaptureOptions, Damage, ScreenInfo};

/// Bytes per pixel in the root window's image. Depth 24 arrives padded to 32.
const BPP: usize = 4;

/// Diff granularity.
const TILE: usize = 64;

/// A rectangle as `[x0, y0, x1, y1]`, exclusive on the far edges.
type Bounds = [usize; 4];

/// Damage rectangles are filled out to their bounding box while the gap costs
/// less than the decoder call it saves.
const MERGE_BUDGET: usize = 100_000;

/// The pointer as XFixes reports it: premultiplied ARGB, plus the position of
/// its hotspot on the root.
#[derive(Debug)]
struct Pointer {
    serial: u32,
    x: i16,
    y: i16,
    width: usize,
    height: usize,
    xhot: u16,
    yhot: u16,
    /// Row-major `0xAARRGGBB`, already premultiplied by the alpha.
    pixels: Vec<u32>,
}

pub struct X11Capture {
    conn: RustConnection,
    root: u32,
    width: u16,
    height: u16,
    /// Shared memory segment, and its system id for cleanup.
    shmseg: u32,
    shmid: i32,
    base: *mut u8,
    len: usize,
    /// Previous frame, for comparison.
    prev: Vec<u8>,
    /// Current frame, read out of the shared segment.
    cur: Vec<u8>,
    /// Scratch for dirty tiles, reused across polls.
    dirty: Vec<bool>,
    /// Tiles already absorbed into an emitted rectangle.
    covered: Vec<bool>,
    /// DAMAGE handle and the region it is subtracted into.
    damage_id: u32,
    region: u32,
    /// Set when the next poll must report everything.
    force_full: bool,
    /// Composite the pointer into frames.
    cursor_on: bool,
    /// `(serial, x, y)` of the pointer last composited.
    cursor_stamp: Option<(u32, i16, i16)>,
    /// Reused buffer for the outgoing rectangles.
    out: Vec<(Damage, Vec<u8>)>,
}

impl X11Capture {
    pub fn new() -> Result<Self, CaptureError> {
        Self::new_on(None).map_err(|e| CaptureError::Unsupported { reason: e })
    }

    /// Connect to an X display. `display` of `None` follows `$DISPLAY`.
    fn new_on(display: Option<&str>) -> Result<Self, String> {
        let (conn, screen) = x11rb::connect(display).map_err(|e| format!("connect: {e}"))?;
        let scr = &conn.setup().roots[screen];
        let root = scr.root;
        let width = scr.width_in_pixels;
        let height = scr.height_in_pixels;
        let len = width as usize * height as usize * BPP;

        // Without MIT-SHM there is no cheap path to pixels.
        conn.shm_query_version()
            .map_err(|e| format!("shm query: {e}"))?
            .reply()
            .map_err(|e| format!("shm version: {e}"))?;

        let shmid = unsafe { libc::shmget(libc::IPC_PRIVATE, len, libc::IPC_CREAT | 0o600) };
        if shmid < 0 {
            return Err(format!("shmget: {}", std::io::Error::last_os_error()));
        }
        let base = unsafe { libc::shmat(shmid, std::ptr::null(), 0) as *mut u8 };
        if base as isize == -1 {
            unsafe { libc::shmctl(shmid, libc::IPC_RMID, std::ptr::null_mut()) };
            return Err(format!("shmat: {}", std::io::Error::last_os_error()));
        }
        let shmseg = conn.generate_id().map_err(|e| format!("shm id: {e}"))?;
        conn.shm_attach(shmseg, shmid as u32, false)
            .map_err(|e| format!("shm attach: {e}"))?
            .check()
            .map_err(|e| format!("shm attach: {e}"))?;

        // The trigger. BOUNDING_BOX is enough because we only ask "anything?".
        conn.damage_query_version(1, 1)
            .map_err(|e| format!("damage query: {e}"))?
            .reply()
            .map_err(|e| format!("damage version: {e}"))?;
        conn.xfixes_query_version(5, 0)
            .map_err(|e| format!("xfixes query: {e}"))?
            .reply()
            .map_err(|e| format!("xfixes version: {e}"))?;

        let damage_id = conn.generate_id().map_err(|e| format!("damage id: {e}"))?;
        damage::create(&conn, damage_id, root, damage::ReportLevel::BOUNDING_BOX)
            .map_err(|e| format!("damage create: {e}"))?
            .check()
            .map_err(|e| format!("damage create: {e}"))?;

        let region = conn.generate_id().map_err(|e| format!("region id: {e}"))?;
        xfixes::create_region(&conn, region, &[])
            .map_err(|e| format!("region create: {e}"))?
            .check()
            .map_err(|e| format!("region create: {e}"))?;

        let tiles = (width as usize).div_ceil(TILE) * (height as usize).div_ceil(TILE);
        Ok(Self {
            conn,
            root,
            width,
            height,
            shmseg,
            shmid,
            base,
            len,
            prev: vec![0u8; len],
            cur: vec![0u8; len],
            dirty: vec![false; tiles],
            covered: vec![false; tiles],
            damage_id,
            region,
            force_full: true,
            cursor_on: false,
            cursor_stamp: None,
            out: Vec::new(),
        })
    }

    /// Read the pointer, or `None` when it is not wanted.
    fn pointer(&mut self) -> Result<Option<Pointer>, CaptureError> {
        if !self.cursor_on {
            return Ok(None);
        }
        let reply = self
            .conn
            .xfixes_get_cursor_image()
            .map_err(|e| self.fail(format!("cursor image: {e}")))?
            .reply()
            .map_err(|e| self.fail(format!("cursor image: {e}")))?;
        Ok(Some(Pointer {
            serial: reply.cursor_serial,
            x: reply.x,
            y: reply.y,
            width: reply.width as usize,
            height: reply.height as usize,
            xhot: reply.xhot,
            yhot: reply.yhot,
            pixels: reply.cursor_image,
        }))
    }

    /// Read the root window into `cur`.
    fn grab(&mut self) -> Result<(), CaptureError> {
        let cookie = self
            .conn
            .shm_get_image(
                self.root,
                0,
                0,
                self.width,
                self.height,
                u32::MAX,
                ImageFormat::Z_PIXMAP.into(),
                self.shmseg,
                0,
            )
            .map_err(|e| self.fail(format!("shm_get_image: {e}")))?;
        // The reply is the sync point: the server has finished writing.
        cookie
            .reply()
            .map_err(|e| self.fail(format!("shm_get_image: {e}")))?;
        let src = unsafe { std::slice::from_raw_parts(self.base, self.len) };
        self.cur.copy_from_slice(src);
        Ok(())
    }

    /// Wrap a connection-level failure and mark us unusable.
    fn fail(&self, reason: String) -> CaptureError {
        CaptureError::Unsupported { reason }
    }

    /// Consume pending damage events. `true` when the server reported a redraw.
    fn triggered(&mut self) -> Result<bool, CaptureError> {
        let mut seen = false;
        loop {
            let ev = self
                .conn
                .poll_for_event()
                .map_err(|e| self.fail(format!("poll: {e}")))?;
            match ev {
                None => break,
                Some(Event::DamageNotify(_)) => seen = true,
                Some(_) => {}
            }
        }
        if seen {
            // Drain the accumulated region so the next poll starts clean.
            self.conn
                .damage_subtract(self.damage_id, xfixes::RegionEnum::NONE, self.region)
                .map_err(|e| self.fail(format!("damage subtract: {e}")))?
                .check()
                .map_err(|e| self.fail(format!("damage subtract: {e}")))?;
            self.conn
                .xfixes_fetch_region(self.region)
                .map_err(|e| self.fail(format!("fetch region: {e}")))?
                .reply()
                .map_err(|e| self.fail(format!("fetch region: {e}")))?;
        }
        Ok(seen)
    }

    /// Find dirty tiles, then emit one rectangle per tile with the pixel data.
    fn diff(&mut self) {
        self.out.clear();
        let stride = self.width as usize * BPP;
        let tiles_x = (self.width as usize).div_ceil(TILE);
        let tiles_y = (self.height as usize).div_ceil(TILE);
        self.dirty.fill(false);

        for ty in 0..tiles_y {
            let y0 = ty * TILE;
            let y1 = (y0 + TILE).min(self.height as usize);
            for tx in 0..tiles_x {
                let x0 = tx * TILE;
                let x1 = ((tx + 1) * TILE).min(self.width as usize);
                let (b0, b1) = (x0 * BPP, x1 * BPP);
                for y in y0..y1 {
                    let row = y * stride;
                    if self.prev[row + b0..row + b1] != self.cur[row + b0..row + b1] {
                        self.dirty[ty * tiles_x + tx] = true;
                        break;
                    }
                }
            }
        }

        // Merge the dirty tiles into as few rectangles as possible, growing each
        // one right and then down while every tile it would cover is dirty.
        self.covered.fill(false);
        let mut rects: Vec<Bounds> = Vec::new();
        for ty in 0..tiles_y {
            for tx in 0..tiles_x {
                let idx = ty * tiles_x + tx;
                if !self.dirty[idx] || self.covered[idx] {
                    continue;
                }

                // Extend right across dirty, uncovered tiles.
                let mut wide = 1;
                while tx + wide < tiles_x
                    && self.dirty[ty * tiles_x + tx + wide]
                    && !self.covered[ty * tiles_x + tx + wide]
                {
                    wide += 1;
                }
                // Extend down while a whole run of that width stays dirty.
                let mut tall = 1;
                'down: while ty + tall < tiles_y {
                    for i in 0..wide {
                        let j = (ty + tall) * tiles_x + tx + i;
                        if !self.dirty[j] || self.covered[j] {
                            break 'down;
                        }
                    }
                    tall += 1;
                }
                for i in 0..wide {
                    for j in 0..tall {
                        self.covered[(ty + j) * tiles_x + tx + i] = true;
                    }
                }

                let x0 = tx * TILE;
                let y0 = ty * TILE;
                let x1 = (x0 + wide * TILE).min(self.width as usize);
                let y1 = (y0 + tall * TILE).min(self.height as usize);
                rects.push([x0, y0, x1, y1]);
            }
        }

        coalesce(&mut rects);

        for [x0, y0, x1, y1] in rects {
            let (w, h) = ((x1 - x0) as u16, (y1 - y0) as u16);
            // Copy the rectangle out, converting BGRA (X11's byte order for a
            // depth-24 root) into the RGBA we promise callers. Walk pixel
            // indices, not bytes: `o` addresses a pixel, and the channels are
            // read relative to it.
            let mut px = Vec::with_capacity(w as usize * h as usize * BPP);
            for y in y0..y1 {
                let row = y * stride;
                for x in x0..x1 {
                    let o = row + x * BPP;
                    px.extend_from_slice(&[self.cur[o + 2], self.cur[o + 1], self.cur[o], 0xff]);
                }
            }
            self.out.push((
                Damage {
                    x: x0 as u16,
                    y: y0 as u16,
                    width: w,
                    height: h,
                },
                px,
            ));
        }
    }

    /// Emit the entire screen as one rectangle.
    fn full(&mut self) {
        self.out.clear();
        let mut px = Vec::with_capacity(self.len);
        for chunk in self.cur.chunks_exact(BPP) {
            px.extend_from_slice(&[chunk[2], chunk[1], chunk[0], 0xff]);
        }
        self.out.push((
            Damage {
                x: 0,
                y: 0,
                width: self.width,
                height: self.height,
            },
            px,
        ));
    }
}

/// Blend the pointer into a BGRA frame of `width` x `height`.
fn composite(pixels: &mut [u8], width: usize, height: usize, p: &Pointer) {
    let x0 = p.x as isize - p.xhot as isize;
    let y0 = p.y as isize - p.yhot as isize;
    let stride = width * BPP;
    for cy in 0..p.height {
        let sy = y0 + cy as isize;
        if sy < 0 || sy >= height as isize {
            continue;
        }
        let row = sy as usize * stride;
        for cx in 0..p.width {
            let sx = x0 + cx as isize;
            if sx < 0 || sx >= width as isize {
                continue;
            }
            let argb = p.pixels[cy * p.width + cx];
            let alpha = (argb >> 24) & 0xff;
            if alpha == 0 {
                continue;
            }
            let inv = 255 - alpha;
            let o = row + sx as usize * BPP;
            pixels[o] = blend(argb & 0xff, pixels[o], inv);
            pixels[o + 1] = blend((argb >> 8) & 0xff, pixels[o + 1], inv);
            pixels[o + 2] = blend((argb >> 16) & 0xff, pixels[o + 2], inv);
        }
    }
}

/// One channel of `src` over `dst`, both premultiplied by `src`'s alpha.
fn blend(src: u32, dst: u8, inv: u32) -> u8 {
    (src + dst as u32 * inv / 255) as u8
}

/// Pixels a merge would add, zero when the two already overlap.
fn added_area(a: &Bounds, b: &Bounds) -> usize {
    let union = area(&merge(a, b)) as isize;
    let parts = (area(a) + area(b)) as isize;
    (union - parts).max(0) as usize
}

fn area(r: &Bounds) -> usize {
    (r[2] - r[0]) * (r[3] - r[1])
}

/// The smallest rectangle containing both.
fn merge(a: &Bounds, b: &Bounds) -> Bounds {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}

/// Whether `a` covers all of `b`.
fn covers(a: &Bounds, b: &Bounds) -> bool {
    a[0] <= b[0] && a[1] <= b[1] && b[2] <= a[2] && b[3] <= a[3]
}

/// Fill the gaps between damage rectangles while that is cheaper than the extra
/// decoder calls they cost, taking the cheapest merge first.
fn coalesce(rects: &mut Vec<Bounds>) {
    loop {
        let mut best: Option<(usize, Bounds)> = None;
        for (i, a) in rects.iter().enumerate() {
            for b in &rects[i + 1..] {
                let cost = added_area(a, b);
                if best.as_ref().map_or(true, |(cheapest, _)| cost < *cheapest) {
                    best = Some((cost, merge(a, b)));
                }
            }
        }
        let Some((cost, union)) = best else { return };
        if cost > MERGE_BUDGET {
            return;
        }
        // Whatever the union swallows no longer needs a rectangle of its own.
        rects.retain(|r| !covers(&union, r));
        rects.push(union);
    }
}

impl CaptureBackend for X11Capture {
    fn info(&self) -> ScreenInfo {
        ScreenInfo {
            width: self.width,
            height: self.height,
            format: "rgba",
        }
    }

    fn poll(&mut self) -> Result<Option<Vec<(Damage, Vec<u8>)>>, CaptureError> {
        let full = self.force_full;
        self.force_full = false;

        let pointer = self.pointer()?;
        let stamp = pointer.as_ref().map(|p| (p.serial, p.x, p.y));
        let moved = stamp != self.cursor_stamp;
        // Drain damage even when a pointer move already forces a grab: events
        // left queued would look like fresh damage on the next poll.
        let damaged = self.triggered()?;
        if !full && !damaged && !moved {
            return Ok(None);
        }

        self.grab()?;
        if let Some(p) = &pointer {
            composite(&mut self.cur, self.width as usize, self.height as usize, p);
        }
        self.cursor_stamp = stamp;

        if full {
            self.full();
        } else {
            self.diff();
        }
        if self.out.is_empty() {
            return Ok(None);
        }
        self.prev.copy_from_slice(&self.cur);
        Ok(Some(std::mem::take(&mut self.out)))
    }

    fn resync(&mut self) {
        self.force_full = true;
    }

    fn configure(&mut self, options: &CaptureOptions) -> bool {
        if options.cursor == self.cursor_on {
            return false;
        }
        self.cursor_on = options.cursor;
        // Turning it off has to repaint where it was, and turning it on must not
        // wait for unrelated damage, or the next frame is full.
        self.force_full = true;
        false
    }
}

impl Drop for X11Capture {
    fn drop(&mut self) {
        let _ = self.conn.damage_destroy(self.damage_id).map(|c| c.check());
        let _ = self.conn.shm_detach(self.shmseg);
        unsafe {
            libc::shmdt(self.base as *const libc::c_void);
            libc::shmctl(self.shmid, libc::IPC_RMID, std::ptr::null_mut());
        }
    }
}

// The shared segment is owned by this struct alone and only read through `base`
// while `cur` is being filled; no aliasing across threads.
unsafe impl Send for X11Capture {}

#[cfg(test)]
mod tests {
    use super::*;

    /// Open a backend, or skip when there is no display to talk to.
    fn connect() -> Option<X11Capture> {
        match X11Capture::new() {
            Ok(c) => Some(c),
            Err(e) => {
                println!("no display ({e}); skipping");
                None
            }
        }
    }

    /// The first poll owes the caller a full frame to make a viewer that just
    /// connected have a baseline to draw.
    #[test]
    fn first_poll_is_full_screen() {
        let Some(mut c) = connect() else { return };
        let info = c.info();
        println!("screen {}x{} {}", info.width, info.height, info.format);

        let batch = c
            .poll()
            .expect("poll")
            .expect("first poll must produce a frame");
        assert_eq!(batch.len(), 1, "first frame should be one full-screen rect");
        let (rect, px) = &batch[0];
        assert_eq!((rect.x, rect.y), (0, 0));
        assert_eq!(rect.width, info.width);
        assert_eq!(rect.height, info.height);
        assert_eq!(px.len(), rect.width as usize * rect.height as usize * 4);
    }

    /// Resync must make the next poll full-screen again, which is what a viewer
    /// that lost its baseline depends on.
    #[test]
    fn resync_forces_full_frame() {
        let Some(mut c) = connect() else { return };
        let info = c.info();
        c.poll().expect("prime").expect("first frame");
        std::thread::sleep(std::time::Duration::from_millis(100));

        c.resync();
        let batch = c
            .poll()
            .expect("poll")
            .expect("resync must produce a frame");
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].0.width, info.width);
        assert_eq!(batch[0].0.height, info.height);
    }

    /// A damage rectangle must carry exactly its own pixels: the right count, and
    /// the bytes actually at those coordinates.
    #[test]
    fn damage_rects_carry_their_own_pixels() {
        let Some(mut c) = connect() else { return };
        c.poll().expect("prime").expect("first frame");

        let (w, h) = (c.width as usize, c.height as usize);
        let stride = w * BPP;
        // A pixel inside the first tile, and one in the last column, which is
        // where the read used to run off the end.
        let spots = [(1usize, 1usize), (w - 1, h - 1)];
        for &(x, y) in &spots {
            let o = y * stride + x * BPP;
            c.cur[o] = 0x11;
            c.cur[o + 1] = 0x22;
            c.cur[o + 2] = 0x33;
        }

        c.diff();
        assert!(!c.out.is_empty(), "painted pixels should show up as damage");

        for (d, px) in &c.out {
            assert_eq!(
                px.len(),
                d.width as usize * d.height as usize * 4,
                "rect {d:?} carries the wrong number of bytes"
            );
            for &(x, y) in &spots {
                let inside = x >= d.x as usize
                    && x < d.x as usize + d.width as usize
                    && y >= d.y as usize
                    && y < d.y as usize + d.height as usize;
                if !inside {
                    continue;
                }
                let i = ((y - d.y as usize) * d.width as usize + (x - d.x as usize)) * 4;
                // X11 gives BGRA; callers are promised RGBA.
                assert_eq!(
                    &px[i..i + 4],
                    &[0x33, 0x22, 0x11, 0xff],
                    "rect {d:?} has the wrong bytes at ({x},{y})"
                );
            }
        }
    }

    /// A frame where everything changed must come back as one rectangle, not one
    /// per tile. The per-rectangle cost is what makes a full repaint slow.
    #[test]
    fn a_full_change_merges_into_one_rectangle() {
        let Some(mut c) = connect() else { return };
        c.poll().expect("prime").expect("first frame");

        // Nudge every byte to make every tile differ from the previous frame.
        for b in c.cur.iter_mut() {
            *b = b.wrapping_add(1);
        }
        c.diff();

        let (w, h) = (c.width, c.height);
        assert_eq!(
            c.out.len(),
            1,
            "expected one merged rectangle, got {:?}",
            c.out.iter().map(|(d, _)| *d).collect::<Vec<_>>()
        );
        let (d, px) = &c.out[0];
        assert_eq!((d.x, d.y, d.width, d.height), (0, 0, w, h));
        assert_eq!(px.len(), w as usize * h as usize * 4);
    }

    /// A gap cheaper to re-encode than to pay for the extra decoder call is
    /// filled in.
    #[test]
    fn scratches_close_together_merge() {
        let mut rects = vec![[0, 0, 64, 64], [128, 0, 192, 64]];
        coalesce(&mut rects);
        assert_eq!(rects, vec![[0, 0, 192, 64]]);
    }

    /// Filling between these costs more than the call it removes, should stay
    /// apart.
    #[test]
    fn distant_scratches_stay_apart() {
        let mut rects = vec![[0, 0, 64, 64], [1000, 1000, 1064, 1064]];
        coalesce(&mut rects);
        assert_eq!(rects.len(), 2);
    }

    /// Whatever a merge swallows no longer needs a rectangle of its own.
    #[test]
    fn a_merge_swallows_rectangles_inside_it() {
        let mut rects = vec![[0, 0, 64, 64], [64, 0, 128, 64], [0, 0, 128, 64]];
        coalesce(&mut rects);
        assert_eq!(rects, vec![[0, 0, 128, 64]]);
    }

    /// Pixels must be RGBA, not X11's native BGRA. Checking the alpha byte
    /// being opaque everywhere also proves the stride is right.
    #[test]
    fn pixels_are_opaque_rgba() {
        let Some(mut c) = connect() else { return };
        let batch = c.poll().expect("poll").expect("first frame");
        let (_, px) = &batch[0];
        assert!(
            px.chunks_exact(4).all(|p| p[3] == 0xff),
            "every pixel should carry an opaque alpha"
        );
    }

    fn pointer(x: i16, y: i16, w: usize, h: usize, xhot: u16, yhot: u16, solid: u32) -> Pointer {
        Pointer {
            serial: 1,
            x,
            y,
            width: w,
            height: h,
            xhot,
            yhot,
            pixels: vec![solid; w * h],
        }
    }

    #[test]
    fn the_cursor_lands_on_its_hotspot() {
        let mut frame = vec![0u8; 4 * 4 * 4];
        // Opaque red, 2x2, hotspot at its top-left corner.
        let p = pointer(1, 1, 2, 2, 0, 0, 0xffff0000);
        composite(&mut frame, 4, 4, &p);

        let at = |x: usize, y: usize| &frame[(y * 4 + x) * 4..(y * 4 + x) * 4 + 4];
        assert_eq!(at(1, 1), &[0x00, 0x00, 0xff, 0x00]);
        assert_eq!(at(2, 2), &[0x00, 0x00, 0xff, 0x00]);
        // Outside the image nothing moved.
        assert_eq!(at(0, 0), &[0, 0, 0, 0]);
        assert_eq!(at(3, 3), &[0, 0, 0, 0]);
    }

    #[test]
    fn a_translucent_cursor_blends_by_its_alpha() {
        let mut frame = vec![0u8; 4 * 4 * 4];
        let p = pointer(0, 0, 1, 1, 0, 0, 0x80808080);
        composite(&mut frame, 4, 4, &p);
        assert_eq!(&frame[0..3], &[0x80, 0x80, 0x80]);
    }

    #[test]
    fn an_offscreen_cursor_is_clipped() {
        let mut frame = vec![0u8; 4 * 4 * 4];
        let p = pointer(-1, -1, 2, 2, 0, 0, 0xffff0000);
        composite(&mut frame, 4, 4, &p);

        // Only the image's bottom-right pixel falls inside, at (0, 0).
        assert_eq!(&frame[0..4], &[0x00, 0x00, 0xff, 0x00]);
        assert_eq!(&frame[(3 * 4 + 3) * 4..(3 * 4 + 3) * 4 + 4], &[0, 0, 0, 0]);
    }
}
