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
  /** Outgoing stream, when we are the sender. */
  sending: { peerId: string; info: ScreenInfo } | null;
  /** Incoming stream shape, when we are the viewer. */
  receiving: ScreenInfo | null;
  stats: { tiles: number; bytes: number };
}

export const castStore = createStore<CastState>({
  devices: [],
  sending: null,
  receiving: null,
  stats: { tiles: 0, bytes: 0 },
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
let out: { channel: Channel; stream: ScreenStream } | null = null;

export function initCast(context: ExtensionContext): void {
  ctx = context;
  castStore.set({ devices: context.getKnownDevices() });
  context.subscriptions.push(
    context.onDeviceSeen((devices) => castStore.set({ devices })),
    context.onChannel(receive)
  );
}

export async function startCast(target: string, label: string): Promise<void> {
  if (!ctx || out) return;
  try {
    const channel = await ctx.openChannel({ transport: "webrtc", target });
    const stream = await startScreenStream(channel);
    out = { channel, stream };
    castStore.set({ sending: { peerId: label, info: stream.info } });
  } catch (err) {
    console.error("[cast] start failed", err);
    stopCast();
  }
}

export function stopCast(): void {
  void out?.stream.stop().catch(() => { });
  out?.channel.close();
  out = null;
  castStore.set({ sending: null });
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

let pending: Pending | null = null;

function receive(channel: Channel): void {
  channel.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const screen = parseScreen(ev.data);
      if (screen) {
        pending = null;
        castStore.set({ receiving: screen, stats: { tiles: 0, bytes: 0 } });
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
    const stats = castStore.get().stats;
    castStore.set({
      stats: { tiles: stats.tiles + 1, bytes: stats.bytes + bytes.byteLength },
    });
    if (pending.have >= pending.total) {
      const tiles = assemble(pending);
      pending = null;
      viewer?.draw(tiles);
    }
  };
  channel.onclose = () => {
    pending = null;
    castStore.set({ receiving: null });
  };
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
