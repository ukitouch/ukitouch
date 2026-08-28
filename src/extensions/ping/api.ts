import type { Channel, ExtensionContext } from "../../core/types";
import { createStore } from "../../core/store";

export interface PingState {
  logs: string[];
  peerId: string | null;
  connecting: boolean;
}

export const pingStore = createStore<PingState>({
  logs: [],
  peerId: null,
  connecting: false,
});

function log(line: string): void {
  const stamp = new Date().toLocaleTimeString("en-GB");
  pingStore.set({
    logs: [...pingStore.get().logs, `${stamp} ${line}`].slice(-100),
  });
}

let ctxRef: ExtensionContext | null = null;
let channel: Channel | null = null;
let cancelled = false;
let lastPingAt = 0;

/** Attach a channel (initiated or incoming). */
function bindChannel(ch: Channel, peerLabel: string): void {
  if (channel && channel !== ch) channel.close();
  channel = ch;
  pingStore.set({ peerId: peerLabel, connecting: false });

  ch.onmessage = (e) => {
    if (e.data === "ping") {
      ch.send("pong");
      log("recv ping, replied pong");
    } else if (e.data === "pong") {
      log(`pong (rtt ${Date.now() - lastPingAt}ms)`);
    } else {
      log(`recv "${String(e.data)}"`);
    }
  };

  ch.onclose = () => {
    if (channel === ch) {
      channel = null;
      pingStore.set({ peerId: null, connecting: false });
    }
    log("channel closed");
  };

  ch.onerror = () => log("send error");
}

/** Logic entry */
export function initPing(ctx: ExtensionContext): void {
  ctxRef = ctx;

  // A remote peer opening a "ping" channel lands here.
  ctx.onChannel((ch) => {
    log("incoming channel");
    bindChannel(ch, "(incoming)");
  });
}

/** Dial a target device. */
export async function openPingChannel(targetId: string): Promise<void> {
  targetId = targetId.replace(/\D/g, ""); // tolerate grouped input ("123 456 789")
  if (!ctxRef || !targetId) return;
  if (channel) channel.close();
  cancelled = false;
  pingStore.set({ connecting: true, peerId: null });
  log(`connecting...`);
  try {
    const ch = await ctxRef.openChannel({
      transport: "webrtc",
      target: targetId,
    });
    if (cancelled) {
      ch.close();
      log("connect cancelled");
      return;
    }
    bindChannel(ch, targetId);
    log("connected");
  } catch (err) {
    if (!cancelled) log(`connect failed: ${String(err)}`);
    pingStore.set({ connecting: false });
  }
}

/** Cancel an in-progress connect. */
export function cancelConnect(): void {
  cancelled = true;
  pingStore.set({ connecting: false });
  log("cancelling...");
}

/** Close the active channel and reset. */
export function disconnect(): void {
  if (channel) channel.close();
  channel = null;
  pingStore.set({ peerId: null, connecting: false });
  log("disconnected");
}

export function sendPing(): void {
  if (!channel) return;
  lastPingAt = Date.now();
  channel.send("ping");
  log("ping →");
}
