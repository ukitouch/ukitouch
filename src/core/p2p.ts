import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { serverConfig } from "./config";
import { deviceUuid, genTempId } from "./identity";
import type { Channel } from "./types";
import { createStore } from "./store";

/*
 * The signaling WS (p2psig protocol) lives in Rust (`net::signaling`); this
 * module is the TS handle onto it, plus the WebRTC P2P facade backed by Rust
 * (`net::webrtc`). Each signaling connection is named (`"primary"` = uuid,
 * `"temp"` = temp-id discovery); events carry the name so each facade only
 * sees its own traffic.
 */

//#region Signaling

export interface Forwarded {
  from: string;
  value: Record<string, unknown>;
}

export interface SignalingApi {
  connect(url: string, id: string, force?: boolean): Promise<void>;
  send(to: string, payload: Record<string, unknown>): Promise<void>;
  query(id: string): Promise<boolean>;
  disconnect(): Promise<void>;
  onForward(h: (f: Forwarded) => void): () => void;
  onNotice(h: (message: string) => void): () => void;
}

interface ForwardEvent {
  name: string;
  from: string;
  value: Record<string, unknown>;
}
interface NoticeEvent {
  name: string;
  message: string;
}

/**
 * @param name unique name for the signaling connection
 */
export function createSignaling(name: string): SignalingApi {
  const forwardHandlers = new Set<(f: Forwarded) => void>();
  const noticeHandlers = new Set<(message: string) => void>();
  let unlisten: Promise<UnlistenFn> | null = null;

  /** Listen event from backend. */
  async function initSigListener(): Promise<void> {
    if (unlisten) return;
    const [f, n] = await Promise.all([
      listen<ForwardEvent>("sig-forward", (e) => {
        if (e.payload.name === name) {
          forwardHandlers.forEach((h) =>
            h({ from: e.payload.from, value: e.payload.value })
          );
        }
      }),
      listen<NoticeEvent>("sig-notice", (e) => {
        if (e.payload.name === name) {
          noticeHandlers.forEach((h) => h(e.payload.message));
        }
      }),
    ]);
    unlisten = Promise.resolve(() => {
      f();
      n();
    });
  }

  return {
    async connect(url, id, force = false) {
      await initSigListener();
      await invoke("sig_connect", { name, url, id, force });
    },
    send(to, payload) {
      return invoke("sig_send", { name, to, payload });
    },
    query(id) {
      return invoke<boolean>("sig_query", { name, id });
    },
    disconnect() {
      return invoke("sig_disconnect", { name });
    },
    onForward(h) {
      forwardHandlers.add(h);
      return () => {
        forwardHandlers.delete(h);
      };
    },
    onNotice(h) {
      noticeHandlers.add(h);
      return () => {
        noticeHandlers.delete(h);
      };
    },
  };
}

/** Shared primary (uuid) signaling connection. */
export const signaling = createSignaling("primary");

/** Set ICE servers and connect the permanent signaling connection. */
export async function startSignaling(): Promise<void> {
  await invoke("net_configure", { iceServers: serverConfig.iceServers });
  await ensureChannelListeners();
  signaling.onNotice((m) => console.warn("[sig]", m));
  await signaling.connect(serverConfig.signaling, deviceUuid, true);
}


//#endregion
//#region Temp-id

/** Pending temp id map to be store as uuid for an actual device */
const pendingResolves = new Map<string, (uuid: string) => void>();
let signalingTemp: ReturnType<typeof createSignaling> | null = null;

signaling.onForward((f) => {
  // A resolve reply carries the target device's uuid.
  if (typeof f.value.uuid === "string") {
    const resolve = pendingResolves.get(f.from);
    if (resolve) {
      pendingResolves.delete(f.from);
      resolve(f.value.uuid);
    }
  }
});

function resolveUuid(tempId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolves.delete(tempId);
      reject(new Error(`could not resolve id \`${tempId}\``));
    }, 5000);
    pendingResolves.set(tempId, (uuid) => {
      clearTimeout(timer);
      resolve(uuid);
    });
    signaling.send(tempId, { resolve: true }).catch((e) => {
      clearTimeout(timer);
      pendingResolves.delete(tempId);
      reject(e);
    });
  });
}

/** Translate a dial target (temp-id or uuid) to a uuid. */
async function resolveTarget(targetId: string): Promise<string> {
  return /^\d{9}$/.test(targetId) ? resolveUuid(targetId) : targetId;
}

export const tempIdStore = createStore<{ enabled: boolean; id: string | null }>({
  enabled: false,
  id: null,
});

export function isTempIdOn(): boolean {
  return tempIdStore.get().enabled;
}

export async function enableTempId(): Promise<string> {
  if (!serverConfig.signaling) throw new Error("no signaling configured");
  if (signalingTemp) {
    await signalingTemp.disconnect();
    signalingTemp = null;
  }

  // Pick a temp id the server doesn't already hold.
  let tempId = genTempId();
  for (let i = 0; i < 20; i++) {
    if (!(await signaling.query(tempId))) break;
    tempId = genTempId();
  }

  signalingTemp = createSignaling("temp");
  signalingTemp.onForward((f) => {
    if (f.value.resolve === true) {
      signalingTemp?.send(f.from, { uuid: deviceUuid }).catch(console.error);
    }
  });
  await signalingTemp.connect(serverConfig.signaling, tempId);
  tempIdStore.set({ enabled: true, id: tempId });
  return tempId;
}

export async function disableTempId(): Promise<void> {
  await signalingTemp?.disconnect();
  signalingTemp = null;
  tempIdStore.set({ enabled: false, id: null });
}

//#endregion
//#region P2P data channels

interface ChannelDataEvent {
  token: string;
  channel_id: number;
  data: string; // base64
  text: boolean;
}
interface ChannelOpenEvent {
  token: string;
  channel_id: number;
  label: string;
  target: string;
}
interface ChannelCloseEvent {
  token: string;
  channel_id: number;
}

let listenersReady: Promise<void> | null = null;
const channels = new Map<string, P2PChannel>();
const incomingHandlers = new Set<(ch: P2PChannel) => void>();
const key = (token: string, id: number) => `${token}:${id}`;

function ensureChannelListeners(): Promise<void> {
  if (listenersReady) return listenersReady;
  listenersReady = Promise.all([
    listen<ChannelOpenEvent>("channel-open", (e) => {
      const ch = new P2PChannel(
        e.payload.token,
        e.payload.channel_id,
        e.payload.label
      );
      channels.set(key(e.payload.token, e.payload.channel_id), ch);
      incomingHandlers.forEach((h) => h(ch));
    }),
    listen<ChannelDataEvent>("channel-data", (e) => {
      const ch = channels.get(key(e.payload.token, e.payload.channel_id));
      ch?.deliver(e.payload.data, e.payload.text);
    }),
    listen<ChannelCloseEvent>("channel-close", (e) => {
      const k = key(e.payload.token, e.payload.channel_id);
      const ch = channels.get(k);
      if (ch) {
        channels.delete(k);
        ch.handleClose();
      }
    }),
  ]).then(() => { });
  return listenersReady;
}

function toBytes(
  data: string | ArrayBuffer | ArrayBufferView | Blob
): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error("Blob send not supported");
}

/** A channel opened over the Rust WebRTC layer. */
class P2PChannel implements Channel {
  readonly label: string;
  readonly token: string;
  readonly channelId: number;
  readyState: string = "connecting";
  bufferedAmount: number = 0;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(token: string, channelId: number, label: string) {
    this.token = token;
    this.channelId = channelId;
    this.label = label;
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    const bytes = toBytes(data);
    const text = typeof data === "string";
    invoke("p2p_send", {
      token: this.token,
      channelId: this.channelId,
      data: bytes,
      text,
    }).catch((e) => {
      console.error("[p2p] send failed", e);
      this.onerror?.(new Event("error"));
    });
  }

  close(): void {
    invoke("p2p_close_channel", {
      token: this.token,
      channelId: this.channelId,
    }).catch((e) => console.error("[p2p] close failed", e));
    this.readyState = "closed";
  }

  /** Deliver an incoming message. */
  deliver(dataB64: string, text: boolean): void {
    if (!this.onmessage) return;
    const bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
    const data: string | Uint8Array = text
      ? new TextDecoder().decode(bytes)
      : bytes;
    this.onmessage(new MessageEvent("message", { data }));
  }

  handleClose(): void {
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
  }
}

/** Open a channel to target. */
export async function openChannel(
  target: string,
  label: string
): Promise<Channel> {
  await ensureChannelListeners();
  const uuid = await resolveTarget(target);
  const token = await invoke<string>("p2p_connect", { target: uuid });
  const channelId = await invoke<number>("p2p_open_channel", { token, label });
  const ch = new P2PChannel(token, channelId, label);
  channels.set(key(token, channelId), ch);
  return ch;
}

/** Register a handler for incoming channels. */
export function onChannel(handler: (ch: Channel) => void): void {
  void ensureChannelListeners();
  incomingHandlers.add(handler);
}

//#endregion