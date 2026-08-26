import type { Channel, ExtensionContext } from "../../core/types";
import { createStore } from "../../core/store";

/**
 * Ping extension logic layer.
 */

export interface PingState {
  logs: string[];
  openTarget: string | null;
}

export const pingStore = createStore<PingState>({ logs: [], openTarget: null });

function log(line: string): void {
  const stamp = new Date().toLocaleTimeString("en-GB");
  pingStore.set({
    logs: [...pingStore.get().logs, `${stamp} ${line}`].slice(-100),
  });
}

let ctxRef: ExtensionContext | null = null;
let channel: Channel | null = null;
let lastPingAt = 0;

/** Logic entry */
export function initPing(ctx: ExtensionContext): void {
  ctxRef = ctx;

  // A remote peer opening a "ping" channel lands here.
  ctx.onChannel((ch) => {
    log("incoming channel");
    ch.onmessage = (e) => {
      if (e.data === "ping") {
        ch.send("pong");
        log(`recv ping → replied pong`);
      } else {
        log(`recv "${String(e.data)}"`);
      }
    };
  });
}

/** Dial a target device, then sendPing() becomes available. */
export async function openPingChannel(targetId: string): Promise<void> {
  targetId = targetId.replace(/\D/g, ""); // tolerate grouped input ("123 456 789")
  if (!ctxRef || !targetId) return;
  log(`opening channel to ${targetId} ...`);
  try {
    const ch = await ctxRef.openChannel({
      transport: "webrtc",
      target: targetId,
    });
    channel = ch;
    pingStore.set({ openTarget: targetId });
    ch.onmessage = (e) => {
      if (e.data === "pong") log(`pong (rtt ${Date.now() - lastPingAt}ms)`);
      else log(`recv "${String(e.data)}"`);
    };
    ch.onclose = () => {
      log("channel closed");
      channel = null;
      pingStore.set({ openTarget: null });
    };
    log("channel open");
  } catch (err) {
    log(`open failed: ${String(err)}`);
  }
}

export function sendPing(): void {
  if (!channel) return;
  lastPingAt = Date.now();
  channel.send("ping");
  log("ping →");
}
