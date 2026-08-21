import type { ComponentType, ReactNode } from "react";
import type { ChannelOptions } from "./peer";

export type { ChannelOptions };

/** Shell layout */
export type Layout = "withSidebar" | "fullscreen";

/** Host platforms, matched against an extension's platform matrix. */
export type HostPlatform = "windows" | "macos" | "linux" | "android" | "ios";

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
  /** This device's persistent id (also its signaling address). */
  readonly deviceId: string;
  /** Open a channel labelled with this extension's id to a target device. */
  openChannel(targetId: string, options?: ChannelOptions): Promise<Channel>;
  /** Called when a remote peer opens a channel labelled with this extension's id. */
  onChannel(handler: (channel: Channel) => void): void;
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
