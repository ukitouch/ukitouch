import type { Channel } from "./types";

/**
 * Transport abstraction.
 *
 * Different kind of transports obly implement their underlying
 * logic to open a channel, extensions themselves should define
 * and implement their own data interface.
 */
export type TransportKind = "webrtc" | "usb" | "ble";

/** Arguments specific to the WebRTC transport. */
export interface WebRtcOpenSpec {
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
export interface UsbOpenSpec {
  transport: "usb";
  // reserved: serial?, port?, ...
}

/**
 * Bluetooth transport.
 */
export interface BleOpenSpec {
  transport: "ble";
  // device address, service uuid, ...
}

/** Everything an extension needs to open a channel over some transport. */
export type OpenSpec = WebRtcOpenSpec | UsbOpenSpec | BleOpenSpec;

/**
 * A channel transport backend. Should implement when opening a channel
 * and a connection comming
 */
export interface Transport {
  readonly kind: TransportKind;
  /** Establish a channel to the peer named by specific. */
  open(spec: OpenSpec, extId: string): Promise<Channel>;
  /** Route future incoming channels labelled `extId` to `handler`. */
  onIncoming(extId: string, handler: (channel: Channel) => void): void;
}

/**
 * Dispatch an open request to the appropriate transport.
 */
export function dispatchOpen(
  transports: ReadonlyMap<TransportKind, Transport>,
  spec: OpenSpec,
  extId: string
): Promise<Channel> {
  const t = transports.get(spec.transport);
  if (!t) return Promise.reject(new Error(`transport not implemented: ${spec.transport}`));
  return t.open(spec, extId);
}

/**
 * Dispatch an incoming channel to the appropriate transport.
 */
export function dispatchOnIncoming(
  transports: ReadonlyMap<TransportKind, Transport>,
  extId: string,
  handler: (channel: Channel) => void
): void {
  for (const t of transports.values()) t.onIncoming(extId, handler);
}
