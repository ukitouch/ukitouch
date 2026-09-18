import {
  createStore,
  startScreenStream,
  type Channel,
  type DeviceRecord,
  type ExtensionContext,
  type ScreenInfo,
  type ScreenStream,
} from "../../api";

export interface CastState {
  devices: DeviceRecord[];
  /** Viewer side: peer whose screen we asked for, until the stream ends. */
  watching: { peerId: string; info: ScreenInfo | null } | null;
  /** Host side: shape of the screen we are sending out. */
  sharing: ScreenInfo | null;
  error: string | null;
}

export const castStore = createStore<CastState>({
  devices: [],
  watching: null,
  sharing: null,
  error: null,
});

/** One JPEG rectangle from a stream, positioned in screen coordinates. */
export interface StreamTile {
  x: number;
  y: number;
  width: number;
  height: number;
  /** JPEG bytes. */
  data: Uint8Array;
}

/** Where incoming frames land; the view puts its canvas here. */
export interface CastViewer {
  resize(width: number, height: number): void;
  draw(tiles: StreamTile[]): void;
}

let viewer: CastViewer | null = null;

export function setViewer(v: CastViewer | null): void {
  viewer = v;
}

let ctx: ExtensionContext | null = null;
/** Viewer side: the channel we opened to watch a peer. */
let watchChannel: Channel | null = null;
/** Guards a connect in flight so a stale one cannot clobber a newer one. */
let watchSeq = 0;
/** Host side: the single peer we are streaming to. */
let share: { channel: Channel; stream: ScreenStream } | null = null;
/** A frame being reassembled from its chunks. */
let pending: Pending | null = null;

export function initCast(context: ExtensionContext): void {
  ctx = context;
  castStore.set({ devices: context.getKnownDevices() });
  context.subscriptions.push(
    context.onDeviceSeen((devices) => castStore.set({ devices })),
    // The channel arriving *is* the request: one-to-one, serve it right away.
    context.onChannel(serve)
  );
}

/** Raise the sidebar-free layout while watching. The shell restores it. */
function layout(watching: boolean): void {
  ctx?.setLayout(watching ? "fullscreen" : "withSidebar");
}

/** Reset viewer state and put the layout back. */
function clearWatching(): void {
  pending = null;
  castStore.set({ watching: null });
  layout(false);
}

//#region Viewer side

/** Ask `target` to stream its screen to us. */
export async function watch(target: string, label: string): Promise<void> {
  if (!ctx) return;
  watchChannel?.close();
  watchChannel = null;
  const seq = ++watchSeq;
  castStore.set({
    watching: { peerId: label, info: null },
    error: null,
  });
  layout(true);
  try {
    const channel = await ctx.openChannel({ transport: "webrtc", target });
    if (seq !== watchSeq) {
      channel.close();
      return;
    }
    watchChannel = channel;
    bindViewer(channel);
  } catch (err) {
    if (seq !== watchSeq) return;
    castStore.set({ error: `connect failed: ${String(err)}` });
    clearWatching();
  }
}

/** Stop watching and drop the layout back to the sidebar. */
export function stopWatching(): void {
  watchSeq++;
  watchChannel?.close();
  watchChannel = null;
  clearWatching();
}

/** Reassemble the frame stream arriving on the channel we opened. */
function bindViewer(channel: Channel): void {
  channel.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const screen = parseScreen(ev.data);
      if (screen) {
        pending = null;
        const w = castStore.get().watching;
        castStore.set({ watching: w ? { ...w, info: screen } : w });
        viewer?.resize(screen.width, screen.height);
        return;
      }
      const frame = parseFrame(ev.data);
      if (frame) {
        pending = { rects: frame.rects, total: frame.total, chunks: [], have: 0 };
      }
      return;
    }

    if (!pending) return;
    const bytes = toBytes(ev.data);
    pending.chunks.push(bytes);
    pending.have += bytes.byteLength;
    if (pending.have < pending.total) return;
    const tiles = assemble(pending);
    pending = null;
    viewer?.draw(tiles);
  };

  channel.onclose = () => {
    if (watchChannel !== channel) return;
    watchChannel = null;
    clearWatching();
  };
}

//#endregion
//#region Host side

/** A peer opened a "cast" channel: send it our screen. */
async function serve(channel: Channel): Promise<void> {
  if (share) {
    // One-to-one: a second viewer gets nothing.
    channel.close();
    return;
  }
  let closed = false;
  channel.onclose = () => {
    closed = true;
    if (share?.channel === channel) stopSharing();
  };
  try {
    const stream = await startScreenStream(channel);
    if (closed) {
      void stream.stop().catch(() => { });
      return;
    }
    share = { channel, stream };
    castStore.set({ sharing: stream.info, error: null });
  } catch (err) {
    channel.close();
    castStore.set({ error: describe(err) });
  }
}

/** Stop streaming our screen. */
export function stopSharing(): void {
  if (!share) return;
  const stopped = share;
  share = null;
  castStore.set({ sharing: null });
  void stopped.stream.stop().catch(() => { });
  stopped.channel.close();
}

//#endregion

/** Turn a capture failure from the host into something worth showing. */
function describe(err: unknown): string {
  const m = String(err).toLowerCase();
  if (m.includes("denied")) return "Screen capture was denied";
  if (m.includes("cancel")) return "Screen capture was cancelled";
  if (m.includes("unsupported")) return "This platform can't share its screen yet";
  return String(err);
}

/** A rectangle's place in a frame's concatenated JPEGs. */
interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  len: number;
}

/** A frame being reassembled from its chunks. */
interface Pending {
  rects: FrameRect[];
  total: number;
  chunks: Uint8Array[];
  have: number;
}

/** Split a frame's concatenated JPEGs back out by their lengths. */
function assemble(p: Pending): StreamTile[] {
  const blob = new Uint8Array(p.total);
  let off = 0;
  for (const part of p.chunks) {
    blob.set(part, off);
    off += part.byteLength;
  }
  let cursor = 0;
  return p.rects.map((r) => {
    const tile: StreamTile = {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      data: blob.subarray(cursor, cursor + r.len),
    };
    cursor += r.len;
    return tile;
  });
}

function parseScreen(text: string): ScreenInfo | null {
  try {
    const parsed = JSON.parse(text) as {
      screen?: { width?: number; height?: number };
    };
    const { width, height } = parsed.screen ?? {};
    if (typeof width === "number" && typeof height === "number") {
      return { width, height, format: "rgba" };
    }
  } catch {
    // not ours
  }
  return null;
}

function parseFrame(text: string): { rects: FrameRect[]; total: number } | null {
  try {
    const parsed = JSON.parse(text) as { frame?: FrameRect[]; total?: number };
    if (Array.isArray(parsed.frame) && typeof parsed.total === "number") {
      return { rects: parsed.frame, total: parsed.total };
    }
  } catch {
    // not ours
  }
  return null;
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(0);
}
