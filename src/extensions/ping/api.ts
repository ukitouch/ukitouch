import type { Channel, ExtensionContext } from "../../core/types";

/**
 * Ping extension logic layer.
 */

export interface PingState {
  logs: string[];
  openTarget: string | null;
}

let state: PingState = { logs: [], openTarget: null };
const listeners = new Set<() => void>();

function set(patch: Partial<PingState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function log(line: string): void {
  const stamp = new Date().toLocaleTimeString("en-GB");
  set({ logs: [...state.logs, `${stamp} ${line}`].slice(-100) });
}

export const pingStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getState(): PingState {
    return state;
  },
};

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
    set({ openTarget: targetId });
    ch.onmessage = (e) => {
      if (e.data === "pong") log(`pong (rtt ${Date.now() - lastPingAt}ms)`);
      else log(`recv "${String(e.data)}"`);
    };
    ch.onclose = () => {
      log("channel closed");
      channel = null;
      set({ openTarget: null });
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
