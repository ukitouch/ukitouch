import type { ComponentType, ReactNode } from "react";
import type { OpenSpec } from "./transport";
import type { DeviceRecord } from "./db/types";

/** A handle that can be released to free a subscription or listener. */
export interface Disposable {
  dispose(): void;
}

/**
 * Wrap a cleanup function as a `Disposable`.
 *
 * @param fn The cleanup to run when {@link Disposable.dispose} is called.
 * @returns A `Disposable` that runs `fn` exactly once on dispose.
 */
export function toDisposable(fn: () => void): Disposable {
  return { dispose: fn };
}

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
  /**
   * Disposables to release together when the extension is deactivated or
   * uninstalled. Subscribe APIs return a `Disposable`; push it here.
   */
  readonly subscriptions: Disposable[];
  /**
   * Request a shell layout for the extension's view.
   *
   * @param layout The target layout.
   */
  setLayout(layout: Layout): void;
  /**
   * Open a channel labelled with this extension's ID.
   *
   * @param request The transport-specific open request.
   * @returns A promise resolving to the opened channel once the handshake completes.
   */
  openChannel(request: OpenSpec): Promise<Channel>;
  /**
   * Handle an incoming channel that a remote peer opened with this extension's id.
   *
   * @param handler Receives each incoming channel.
   * @returns A `Disposable` that unregisters the handler.
   */
  onChannel(handler: (channel: Channel) => void): Disposable;
  /**
   * Abort an in-progress {@link openChannel}.
   *
   * @returns A promise that resolves once the pending connection is cancelled.
   */
  cancelOpenChannel(): Promise<void>;
  /**
   * Read the current known-device list.
   *
   * @returns The snapshot of known devices.
   */
  getKnownDevices(): DeviceRecord[];
  /**
   * Subscribe to the known-device list. The handler receives the full current
   * list immediately, then again on every change.
   *
   * @param handler Receives the full known-device list.
   * @returns A `Disposable` that unsubscribes the handler.
   */
  onDeviceSeen(handler: (devices: DeviceRecord[]) => void): Disposable;
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
   * The whole page layout that will be shown to the main view area when active.
   */
  component: ComponentType;
}
