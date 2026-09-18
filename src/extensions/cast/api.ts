import {
  createStore,
  startScreenStream,
  type Channel,
  type DamageFrame,
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

/** Where incoming tiles land; the view puts its canvas here. */
export interface CastViewer {
  resize(width: number, height: number): void;
  draw(tile: DamageFrame): void;
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

function receive(channel: Channel): void {
  channel.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const info = parseScreen(ev.data);
      if (info) {
        castStore.set({ receiving: info, stats: { tiles: 0, bytes: 0 } });
        viewer?.resize(info.width, info.height);
      }
      return;
    }
    const tile = parseTile(toBytes(ev.data));
    if (!tile) return;
    viewer?.draw(tile);
    const stats = castStore.get().stats;
    castStore.set({
      stats: {
        tiles: stats.tiles + 1,
        bytes: stats.bytes + tile.width * tile.height * 4,
      },
    });
  };
  channel.onclose = () => castStore.set({ receiving: null });
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

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(0);
}

/** One tile: `[x, y, w, h]` little-endian u16, then `w * h * 4` RGBA bytes. */
function parseTile(buf: Uint8Array): DamageFrame | null {
  if (buf.byteLength < 8) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const x = dv.getUint16(0, true);
  const y = dv.getUint16(2, true);
  const width = dv.getUint16(4, true);
  const height = dv.getUint16(6, true);
  const need = width * height * 4;
  if (buf.byteLength - 8 < need) return null;
  return {
    x,
    y,
    width,
    height,
    data: new Uint8Array(buf.buffer, buf.byteOffset + 8, need),
  };
}
