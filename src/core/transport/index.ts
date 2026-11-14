import type { Disposable } from "../types";

/**
 * TODO: Current implementation is a WebRTC DataChannel, USB / Bluetooth transports will implement
 * the same shape.
 */
export interface Channel {
  /** Extension's id.  */
  readonly label: string;
  readonly readyState: ChannelReadyState;
  /** Bytes queued but not yet sent. Used for backpressure checks */
  readonly bufferedAmount: number;
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
  close(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: Event) => void) | null;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  /**
   * Bridge a loopback TCP address into this channel.
   *
   * @param addr - The native extension's loopback address.
   * @returns A `Disposable` that unbinds the pipe.
   */
  bindPipe?(addr: string): Promise<Disposable>;
}

export type ChannelReadyState = "connecting" | "open" | "closed";

/** Arguments specific to the WebRTC transport. */
export interface WebRtcOpenSpec {
  transport: "webrtc";
  /**
   * The other device's id (uuid or temp id).
   */
  target: string;
}

/**
 * USB transport
 */
export interface UsbOpenSpec {
  transport: "usb";
  /** The other device's serial. */
  serial?: string;
}

/**
 * Bluetooth transport.
 * 
 * TODO: not implemented yet
 */
export interface BleOpenSpec {
  transport: "ble";
  // device address, service uuid, ...
}

/** Everything an extension needs to open a channel over some transport. */
export type OpenSpec = WebRtcOpenSpec | UsbOpenSpec | BleOpenSpec;
