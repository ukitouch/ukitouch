import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createStore } from "../utils/store";
import { toDisposable, type Disposable } from "../types";
import { Channel, ChannelReadyState } from ".";

export interface UsbDevice {
  serial: string,
  description: string,
}

export const usbStore = createStore<{ devices: UsbDevice[] }>({ devices: [] });

/** Refresh the usb device list from the Rust backend. */
export async function refreshUsbDevices(): Promise<void> {
  try {
    const devices = await invoke<UsbDevice[]>("usb_list_devices");
    usbStore.set({ devices });
  } catch (e) {
    console.warn("[usb] refresh failed", e);
  }
}

//#region Channels

interface UsbChannelOpenEvent {
  channel_id: number;
  label: string;
}
interface UsbChannelDataEvent {
  channel_id: number;
  data: string; // base64
  /** Whether the data is text. */
  text: boolean;
}
interface UsbChannelCloseEvent {
  channel_id: number;
}

let listenersReady: Promise<void> | null = null;
const channels = new Map<number, UsbChannel>();
const incomingHandlers = new Map<string, Set<(ch: Channel) => void>>();

function ensureListeners(): Promise<void> {
  if (listenersReady) return listenersReady;
  listenersReady = Promise.all([
    listen<UsbChannelOpenEvent>("usb-channel-open", (e) => {
      const ch = new UsbChannel(e.payload.channel_id, e.payload.label);
      ch.readyState = "open";
      ch.onopen?.(new Event("open"));
      channels.set(ch.channelId, ch);
      // Route by label (the dialing extension's id), unmatched labels stay inert.
      incomingHandlers.get(e.payload.label)?.forEach((h) => h(ch));
    }),
    listen<UsbChannelDataEvent>("usb-channel-data", (e) => {
      const ch = channels.get(e.payload.channel_id);
      const bytes = Uint8Array.from(atob(e.payload.data), (c) => c.charCodeAt(0));
      ch?.deliver(e.payload.text, bytes);
    }),
    listen<UsbChannelCloseEvent>("usb-channel-close", (e) => {
      const ch = channels.get(e.payload.channel_id);
      if (ch) {
        channels.delete(e.payload.channel_id);
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

/** A channel opened over the Rust USB (adb) layer. */
class UsbChannel implements Channel {
  readonly label: string;
  readonly channelId: number;
  readyState: ChannelReadyState = "connecting";
  bufferedAmount: number = 0;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  /** Pipes bridged into this channel, to unbind when it closes. */
  private pipes = new Set<number>();

  constructor(channelId: number, label: string) {
    this.channelId = channelId;
    this.label = label;
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    const bytes = toBytes(data);
    const text = typeof data === "string";
    invoke("usb_send", { channelId: this.channelId, data: bytes, text }).catch(
      (e) => {
        console.error("[usb] send failed", e);
        this.onerror?.(new Event("error"));
      }
    );
  }

  close(): void {
    this.unbindPipes();
    invoke("usb_close_channel", { channelId: this.channelId }).catch((e) =>
      console.error("[usb] close failed", e)
    );
    this.readyState = "closed";
  }

  async bindPipe(addr: string): Promise<Disposable> {
    const { id } = await invoke<{ id: number }>("pipe_bind", {
      target: { kind: "usb", channelId: this.channelId },
      addr,
    });
    this.pipes.add(id);
    return toDisposable(() => this.unbindPipe(id));
  }

  /** Close one pipe if it is still ours. */
  private unbindPipe(id: number): void {
    if (!this.pipes.delete(id)) return;
    invoke("pipe_unbind", { id }).catch((e) =>
      console.error("[usb] pipe unbind failed", e)
    );
  }

  /** Drop every pipe bridged into this channel. */
  private unbindPipes(): void {
    for (const id of this.pipes) void invoke("pipe_unbind", { id }).catch(() => { });
    this.pipes.clear();
  }

  /**
   * Deliver an incoming message.
   * 
   * text as a string, bytes as raw
   */
  deliver(text: boolean, bytes: Uint8Array): void {
    if (!this.onmessage) return;
    this.onmessage(
      new MessageEvent("message", {
        data: text ? new TextDecoder().decode(bytes) : bytes,
      })
    );
  }

  handleClose(): void {
    this.unbindPipes();
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
  }
}

/** Open a USB channel to `serial`, labelled `label`. */
export async function openUsbChannel(
  label: string,
  device?: UsbDevice
): Promise<Channel> {
  await ensureListeners();

  // TODO: Error handling
  const channelId = await invoke<number>("usb_open_channel", { serial: device?.serial, label });
  const ch = new UsbChannel(channelId, label);
  ch.readyState = "open";
  ch.onopen?.(new Event("open"));
  channels.set(channelId, ch);
  return ch;
}

/**
 * Register a handler for incoming USB channels.
 *
 * @param extId The extension id whose channels to route here.
 * @param handler Receives each incoming USB channel.
 * @returns An unsubscribe function that removes the handler.
 */
export function onUsbChannel(
  extId: string,
  handler: (ch: Channel) => void
): () => void {
  void ensureListeners();
  let handlers = incomingHandlers.get(extId);
  if (!handlers) {
    handlers = new Set();
    incomingHandlers.set(extId, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) incomingHandlers.delete(extId);
  };
}

//#endregion
//#region Listener

export const usbListenerStore = createStore<{ enabled: boolean }>({
  enabled: false,
});

/** Start the device-side gateway listener (phone accepts USB connections). */
export async function enableUsbListener(): Promise<void> {
  await invoke("usb_listen_start");
  usbListenerStore.set({ enabled: true });
}

/** Stop the device-side gateway listener. */
export async function disableUsbListener(): Promise<void> {
  await invoke("usb_listen_stop");
  usbListenerStore.set({ enabled: false });
}

//#endregion