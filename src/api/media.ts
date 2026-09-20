/** Host-side: Screen streaming API */
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

/** A rectangle's pixels, as delivered by the host. */
export interface DamageFrame extends Damage {
  /** `width * height * 4` bytes, row-major, RGBA. */
  data: Uint8Array;
}

/** Screen dimensions and pixel layout. */
export interface ScreenInfo {
  width: number;
  height: number;
  /** Always `"rgba"`. */
  format: "rgba";
  /** The screen's own size, when it is sending us a scaled version. */
  source?: ScreenSize;
}

/** A pixel size. */
export interface ScreenSize {
  width: number;
  height: number;
}

/** Capture options to the screen collector. */
export interface CaptureOptions {
  /** Include the cursor in the frames. */
  cursor?: boolean;
}

/** Options to tell streamer how a frame be like. */
export interface StreamOptions extends CaptureOptions {
  /** Resolution scale, up to 1. */
  resolutionScale?: number;
}

/** Reasons of capture could not start or stopped. */
export type CaptureFailure =
  | "denied"
  | "cancelled"
  | "unsupported";

/** Result of trying to start a monitor. */
export type StartResult =
  | { ok: true; monitor: ScreenMonitor }
  | { ok: false; reason: CaptureFailure; detail?: string };

/** Screen collector's interface */
export interface ScreenMonitor {
  /** Dimensions and layout of the captured screen. */
  readonly info: ScreenInfo;
  /**
   * Subscribe to changed rectangles.
   *
   * @param handler receives each batch of changed rectangles
   * @returns a `Disposable` that unsubscribes the handler
   */
  onDamage(handler: (frames: DamageFrame[]) => void): Disposable;
  /**
   * Subscribe to the monitor stopping.
   *
   * @param handler called once, with a reason if capture failed on its own
   * @returns a `Disposable` that unsubscribes the handler
   */
  onStop(handler: (reason?: string) => void): Disposable;
  /** Ask for the whole screen again. */
  resync(): Promise<void>;
  /** Configure the capture options of the following frames. */
  configure(options: CaptureOptions): Promise<void>;
  /** Stop capturing. */
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

/** Host-side message shapes. */
type HostEvent =
  | { kind: "frame"; rects: RectSpan[]; total: number }
  | { kind: "stopped"; reason?: string };

/**
 * Start capturing the screen.
 *
 * @param options capture options to the screen collector
 * @returns the started monitor, or why it could not start
 */
export async function createScreenMonitor(options?: CaptureOptions): Promise<StartResult> {
  const damageHandlers = new Set<(frames: DamageFrame[]) => void>();
  const stopHandlers = new Set<(reason?: string) => void>();
  let pending: { rects: RectSpan[]; total: number } | null = null;
  let stopped = false;

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

      // handle the frame
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
    started = await invoke("capture_start", { onEvent: on_event, options });
  } catch (err) {
    return { ok: false, reason: classify(String(err)), detail: String(err) };
  }

  // init info
  const screen: ScreenInfo = {
    width: started.width,
    height: started.height,
    format: started.format,
  };
  const monitorId = started.id;

  // create the monitor
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
    async configure(options: CaptureOptions) {
      await invoke("capture_configure", { id: monitorId, options });
    },
    async stop() {
      await invoke("capture_stop", { id: monitorId });
    },
  };
  return { ok: true, monitor };
}

/** A running screen stream to the viewer. */
export interface ScreenStream {
  readonly id: number;
  /** Shape of the screen being sent. */
  readonly info: ScreenInfo;
  /** Configure the capture options of the following frames. */
  configure(options: StreamOptions): Promise<void>;
  /** Stop streaming. */
  stop(): Promise<void>;
}

/**
 * Stream this screen onto an channel.
 *
 * TODO: WebRTC only for now
 *
 * @param channel an opened channel
 * @param options capture options
 * @returns the running stream
 */
export async function startScreenStream(
  channel: ScreenChannel,
  options?: StreamOptions
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
  }>("start_screen_stream", { token, channelId, options });

  return {
    id: started.id,
    info: { width: started.width, height: started.height, format: started.format },
    configure: (options) =>
      invoke("stream_configure", { id: started.id, options }),
    stop: () => invoke("stop_screen_stream", { id: started.id }),
  };
}

/**
 * Map a host error message to a failure kind.
 *
 * @param message the error text from the host
 * @returns the matching failure kind
 */
function classify(message: string): CaptureFailure {
  const m = message.toLowerCase();
  if (m.includes("denied")) return "denied";
  if (m.includes("cancel")) return "cancelled";
  return "unsupported";
}
