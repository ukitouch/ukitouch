import type { Disposable } from "../types";

/**
 * TODO: Current implementation is a WebRTC DataChannel, USB / Bluetooth transports will implement
 * the same shape, invisible to extensions.
 */
export interface Channel {
  readonly label: string;
  readonly readyState: string;
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
   * @param addr The sidecar's loopback address.
   * @returns A `Disposable` that unbinds the pipe.
   */
  bindPipe?(addr: string): Promise<Disposable>;
}

/** Arguments specific to the WebRTC transport. */
interface WebRtcOpenSpec {
  transport: "webrtc";
  /**
   * The other device's id (uuid or temp id).
   */
  target: string;
  reliable?: boolean;
}

/**
 * USB transport
 */
interface UsbOpenSpec {
  transport: "usb";
  serial?: string;
}

/**
 * Bluetooth transport.
 * 
 * TODO: not implemented yet
 */
interface BleOpenSpec {
  transport: "ble";
  // device address, service uuid, ...
}

/** Everything an extension needs to open a channel over some transport. */
export type OpenSpec = WebRtcOpenSpec | UsbOpenSpec | BleOpenSpec;
