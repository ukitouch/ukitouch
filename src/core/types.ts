import type { ComponentType, ReactNode } from "react";
import type { OpenSpec } from "./transport";
import type { DeviceRecord } from "./db/types";

/** Shell layout */
export type Layout = "withSidebar" | "fullscreen";

/** Host platforms, matched against an extension's platform matrix. */
export type HostPlatform = "windows" | "linux" | "android";

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
}

/** API the host hands to an extension's logic layer (activate). */
export interface ExtensionContext {
  setLayout(layout: Layout): void;
  /**
   * Open a channel labelled with this extension's ID.
   * 
   * @param request The transport specific.
   */
  openChannel(request: OpenSpec): Promise<Channel>;
  /** Called when a remote peer opens a channel labelled with this extension's id. */
  onChannel(handler: (channel: Channel) => void): void;
  /** Known devices from the device store. */
  getKnownDevices(): DeviceRecord[];
  /**
   * Subscribe to the known-device list. The handler receives the full current
   * list once immediately, then again on every change.
   */
  onDeviceSeen(handler: (devices: DeviceRecord[]) => void): () => void;
}

export interface ExtensionDefinition {
  /** Unique id. Doubles as the channel label. */
  id: string;
  /** Display name (sidebar tooltip, page title). */
  title: string;
  /** Sidebar icon. */
  icon: ReactNode;
  /** Supported platforms; undefined = all. */
  platforms?: HostPlatform[];
  /**
   * Logic layer entry. Called once at app startup, independent of the view lifecycle.
   * May return a cleanup function.
   */
  activate?: (ctx: ExtensionContext) => void | (() => void);
  /**
   * View layer: rendered in the main area when active.
   */
  component: ComponentType;
}
