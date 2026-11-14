import {
  createStore,
  type Channel,
  type DeviceRecord,
  type NetContext,
} from "@ukitouch/api";

interface PingState {
  logs: string[];
  /** The connection status. */
  connection: Connection;
  devices: DeviceRecord[];
}

/** The connection status. */
type Connection =
  | { status: "idle" }
  | { status: "connecting"; peerId: string }
  | { status: "connected"; peerId: string };

export const pingStore = createStore<PingState>({
  logs: [],
  connection: { status: "idle" },
  devices: [],
});

let ctxRef: NetContext | null = null;
let channel: Channel | null = null;
let cancelled = false;
let lastPingAt = 0;

/** Attach a channel (initiated or incoming). */
function bindChannel(ch: Channel, peerLabel: string): void {
  if (channel && channel !== ch) channel.close();
  channel = ch;
  pingStore.set({ connection: { status: "connected", peerId: peerLabel } });

  ch.onmessage = (e) => {
    const text =
      typeof e.data === "string"
        ? e.data
        : new TextDecoder().decode(e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data));
    if (text === "ping") {
      ch.send("pong");
      log("recv ping, replied pong");
    } else if (text === "pong") {
      log(`pong (rtt ${Date.now() - lastPingAt}ms)`);
    } else {
      log(`recv "${text}"`);
    }
  };

  ch.onclose = () => {
    if (channel === ch) {
      channel = null;
      pingStore.set({ connection: { status: "idle" } });
    }
    log("channel closed");
  };

  ch.onerror = () => log("send error");
}

/** Logic entry */
export function initPing(ctx: NetContext): void {
  ctxRef = ctx;

  pingStore.set({ devices: ctx.getKnownDevices() });
  ctx.onDeviceSeen((devices) => pingStore.set({ devices }));

  // A remote peer opening a "ping" channel lands here.
  ctx.onChannel((ch) => {
    log("incoming channel");
    bindChannel(ch, "(incoming)");
  });
}

/** Shared WebRTC dial: no digit-stripping, `label` is what the status/log shows. */
async function dialWebRtc(target: string, label: string): Promise<void> {
  if (!ctxRef || !target) return;
  if (channel) channel.close();
  cancelled = false;
  pingStore.set({ connection: { status: "connecting", peerId: label } });
  log(`connecting...`);
  try {
    const ch = await ctxRef.openChannel({ transport: "webrtc", target });
    if (cancelled) {
      ch.close();
      log("connect cancelled");
      return;
    }
    bindChannel(ch, label);
    log("connected");
  } catch (err) {
    if (!cancelled) log(`connect failed: ${String(err)}`);
    pingStore.set({ connection: { status: "idle" } });
  }
}

/** Dial by a user-entered id. */
export function openPingChannel(targetId: string): Promise<void> {
  return dialWebRtc(targetId.replace(/\D/g, ""), targetId);
}

/** Dial a known device directly by uuid. */
export function openPingChannelByUuid(uuid: string, label: string): Promise<void> {
  return dialWebRtc(uuid, label);
}

/** Dial a USB device by serial. */
export async function openUsbPingChannel(serial: string): Promise<void> {
  if (!ctxRef || !serial) return;
  if (channel) channel.close();
  cancelled = false;
  pingStore.set({ connection: { status: "connecting", peerId: serial } });
  log(`connecting to ${serial} (usb)...`);
  try {
    const ch = await ctxRef.openChannel({ transport: "usb", serial });
    if (cancelled) {
      ch.close();
      log("connect cancelled");
      return;
    }
    bindChannel(ch, serial);
    log("connected (usb)");
  } catch (err) {
    if (!cancelled) log(`connect failed: ${String(err)}`);
    pingStore.set({ connection: { status: "idle" } });
  }
}

/** Cancel an in-progress connect. */
export function cancelConnect(): void {
  cancelled = true;
  pingStore.set({ connection: { status: "idle" } });
  log("cancelled");
  // Tear down the pending connection at the network level.
  if (ctxRef) {
    void ctxRef.cancelOpenChannel().catch((e) => console.error("[ping] cancel failed", e));
  }
}

/** Close the active channel and reset. */
export function disconnect(): void {
  if (channel) channel.close();
  channel = null;
  pingStore.set({ connection: { status: "idle" } });
  log("disconnected");
}

export function sendPing(): void {
  if (!channel) return;
  lastPingAt = Date.now();
  channel.send("ping");
  log("ping");
}

function log(line: string): void {
  const stamp = new Date().toLocaleTimeString();
  pingStore.set({
    logs: [...pingStore.get().logs, `${stamp} ${line}`].slice(-100),
  });
}
