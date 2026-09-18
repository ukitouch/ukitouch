/**
 * Screen capture API.
 *
 * A monitor is a full-screen pixel source that reports only what changed. It is
 * not tied to any particular use: showing a screen, or driving one, both start
 * from the same rectangles.
 *
 * The host does the platform work. Callers only see rectangles and pixels, and
 * never have to know which display server or OS they are on.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  toDisposable,
  type Channel as ScreenChannel,
  type Disposable,
} from "../core/types";

/** A changed rectangle, in screen pixels. */
export interface Damage {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A rectangle's pixels, as delivered by the host.
 *
 * `data` is exactly `width * height * 4` bytes, row-major, RGBA.
 * This is the layout `ImageData` wants.
 */
export interface DamageFrame extends Damage {
  data: Uint8Array;
}

/** Screen dimensions and pixel layout. */
export interface ScreenInfo {
  width: number;
  height: number;
  /** Always `"rgba"`. */
  format: "rgba";
}

/** Reasons of capture could not start or stopped on its own. */
export type CaptureFailure =
  /** The user refused the capture request. */
  | "denied"
  /** The user dismissed the capture request without deciding. */
  | "cancelled"
  /** This platform has no capture backend. */
  | "unsupported";

/** Result of trying to start a monitor. */
export type StartResult =
  | { ok: true; monitor: ScreenMonitor }
  | { ok: false; reason: CaptureFailure; detail?: string };

/** A running screen source. */
export interface ScreenMonitor {
  /** Dimensions and layout of the captured screen. */
  readonly info: ScreenInfo;
  /**
   * Subscribe to changed rectangles.
   *
   * @param handler Receives each batch of changed rectangles.
   * @returns A `Disposable` that unsubscribes the handler.
   */
  onDamage(handler: (frames: DamageFrame[]) => void): Disposable;
  /**
   * Subscribe to the monitor stopping.
   *
   * @param handler Called once, with a reason if capture failed on its own.
   * @returns A `Disposable` that unsubscribes the handler.
   */
  onStop(handler: (reason?: string) => void): Disposable;
  /** Ask for the whole screen again, for a viewer that lost its baseline. */
  resync(): Promise<void>;
  /** Stop capturing and release the platform resources. */
  stop(): Promise<void>;
}

/** One rectangle's place in a frame's pixel blob. */
interface RectSpan {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Byte offset of this rectangle's pixels in the blob. */
  offset: number;
  /** Byte length. */
  len: number;
}

/** Host-side message shapes. `kind` is the tag. */
type HostEvent =
  | { kind: "frame"; rects: RectSpan[]; total: number }
  | { kind: "stopped"; reason?: string };
/**
 * Start capturing the screen.
 *
 * @returns The started monitor, or why it could not start.
 */
export async function createScreenMonitor(): Promise<StartResult> {
  const damageHandlers = new Set<(frames: DamageFrame[]) => void>();
  const stopHandlers = new Set<(reason?: string) => void>();
  let pending: { rects: RectSpan[]; total: number } | null = null;
  let stopped = false;
  // A frame's rectangles arrive described in JSON, then all of their pixels in
  // one raw message.
  const on_event = new Channel<HostEvent | ArrayBuffer>();
  on_event.onmessage = (message) => {
    if (message instanceof ArrayBuffer) {
      if (!pending) return;
      const { rects, total } = pending;
      pending = null;
      if (message.byteLength !== total) {
        // A truncated blob means the baseline is now suspect, drop the frame
        // and the caller can ask for the screen again.
        return;
      }
      // Each rectangle is a view into the one blob, nothing is copied.
      const frames: DamageFrame[] = rects.map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        data: new Uint8Array(message, r.offset, r.len),
      }));
      if (frames.length > 0) damageHandlers.forEach((h) => h(frames));
      return;
    }

    switch (message.kind) {
      case "frame":
        pending = { rects: message.rects, total: message.total };
        break;
      case "stopped":
        stopped = true;
        stopHandlers.forEach((h) => h(message.reason));
        break;
    }
  };

  let started: { id: number; width: number; height: number; format: "rgba" };
  try {
    started = await invoke("capture_start", { onEvent: on_event });
  } catch (err) {
    return { ok: false, reason: classify(String(err)), detail: String(err) };
  }

  const screen: ScreenInfo = {
    width: started.width,
    height: started.height,
    format: started.format,
  };
  const monitorId = started.id;

  const monitor: ScreenMonitor = {
    info: screen,
    onDamage(handler) {
      damageHandlers.add(handler);
      return toDisposable(() => damageHandlers.delete(handler));
    },
    onStop(handler) {
      stopHandlers.add(handler);
      if (stopped) handler();
      return toDisposable(() => stopHandlers.delete(handler));
    },
    async resync() {
      await invoke("capture_resync", { id: monitorId });
    },
    async stop() {
      await invoke("capture_stop", { id: monitorId });
    },
  };
  return { ok: true, monitor };
}

/** A running screen stream to a peer. */
export interface ScreenStream {
  readonly id: number;
  /** Shape of the screen being sent. */
  readonly info: ScreenInfo;
  /** Stop sending. */
  stop(): Promise<void>;
}

/**
 * Stream this screen onto an already-open WebRTC channel.
 *
 * TODO: WebRTC only for now; other transports open up once this path holds.
 *
 * @param channel An open channel from `openChannel({ transport: "webrtc" })`.
 * @returns The running stream, for stats and to stop it.
 */
export async function startScreenStream(
  channel: ScreenChannel
): Promise<ScreenStream> {
  const { token, channelId } = channel as unknown as {
    token?: string;
    channelId?: number;
  };
  if (!token || channelId === undefined) {
    throw new Error("screen streaming needs a WebRTC channel");
  }
  const started = await invoke<{
    id: number;
    width: number;
    height: number;
    format: "rgba";
  }>("start_screen_stream", { token, channelId });
  return {
    id: started.id,
    info: { width: started.width, height: started.height, format: started.format },
    stop: () => invoke("stop_screen_stream", { id: started.id }),
  };
}

/**
 * Map a host error message to a failure kind.
 *
 * @param message The error text from the host.
 * @returns The matching failure kind.
 */
function classify(message: string): CaptureFailure {
  const m = message.toLowerCase();
  if (m.includes("denied")) return "denied";
  if (m.includes("cancel")) return "cancelled";
  return "unsupported";
}
