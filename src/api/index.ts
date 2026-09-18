/**
 * Public extension API.
 *
 * Extensions code against this module. Bundled extensions import it directly;
 * installed (zip) extensions use the same surface at runtime through `window.yatouch`.
 */
import * as React from "react";
import { registerExtension } from "../core/registry";
import { getHostPlatform, readClipboardText, showToast, writeClipboardText } from "../core/host";
import { getHostInfo } from "../core/hostinfo";
import { refreshUsbDevices, usbStore } from "../core/usb";
import { createStore } from "../core/store";
import { createScreenMonitor, startScreenStream } from "./media";
import type {
  ExtensionContext,
  ExtensionDefinition as CoreExtensionDefinition,
  HostPlatform,
  Layout,
  Disposable,
  Channel,
} from "../core/types";
import { toDisposable } from "../core/types";
import type { OpenSpec } from "../core/transport";
import type { DeviceRecord, HelloInfo } from "../core/db";
import { Select } from "../components/Select";
import { ToastProvider, useToast } from "../components/Toast";
import { Button } from "../components/Button";
import { SettingRow } from "../components/SettingRow";
import { PageHeader } from "../components/PageHeader";
import { SectionHeader } from "../components/SectionHeader";

export { React };
export {
  Select,
  ToastProvider,
  useToast,
  Button,
  SettingRow,
  PageHeader,
  SectionHeader,
  getHostPlatform,
  getHostInfo,
  readClipboardText,
  writeClipboardText,
  refreshUsbDevices,
  usbStore,
  createStore,
  showToast,
  createScreenMonitor,
  startScreenStream,
};

export type {
  ExtensionContext,
  HostPlatform,
  Layout,
  Disposable,
  Channel,
  OpenSpec,
  DeviceRecord,
  HelloInfo,
};

export type {
  Damage,
  DamageFrame,
  ScreenInfo,
  ScreenMonitor,
  ScreenStream,
  StartResult,
  CaptureFailure,
} from "./media";

export type { UsbDevice } from "../core/usb";
export type { Store } from "../core/store";
export type { ToastKind } from "../core/host";

export { toDisposable };

/**
 * What an extension declares.
 */
export interface ExtensionDefinition {
  /** Unique id. Doubles as the channel label. */
  id: string;
  /** Display name (sidebar tooltip, page title). Defaults to `id`. */
  title?: string;
  /** Sidebar icon. */
  icon?: React.ReactNode;
  /** Supported platforms; undefined = all. */
  platforms?: HostPlatform[];
  /**
   * Logic layer entry. Called once at app startup, independent of the view
   * lifecycle.
   * 
   * @returns a cleanup function
   */
  activate?: (ctx: ExtensionContext) => void | (() => void);
  /** View layer, rendered in the main area when active. */
  component?: React.ComponentType;
  /** Back-compat alias for `component`. */
  view?: React.ComponentType;
}

/**
 * Fill defaults into a public definition.
 *
 * @param def The definition written by the extension author.
 * @returns The host-side definition with defaults applied.
 */
function normalize(def: ExtensionDefinition): CoreExtensionDefinition {
  return {
    id: def.id,
    title: def.title ?? def.id,
    icon: def.icon ?? React.createElement(React.Fragment, null),
    platforms: def.platforms,
    component: def.component ?? def.view ?? (() => null),
    activate: def.activate,
  };
}

/**
 * Register an extension. Bundled extensions call this at module top level.
 *
 * @param def The definition to register.
 * @returns The normalized host-side definition.
 */
export function defineExtension(
  def: ExtensionDefinition
): CoreExtensionDefinition {
  const normalized = normalize(def);
  registerExtension(normalized);
  return normalized;
}

/** Runtime API exposed to installed (zip) extensions on `window.yatouch`. */
export interface YatouchRuntime {
  /** React instance for building views. */
  React: typeof React;
  /** Shared UI components reusable by extensions. */
  components: {
    Select: typeof Select;
    ToastProvider: typeof ToastProvider;
    useToast: typeof useToast;
    Button: typeof Button;
    SettingRow: typeof SettingRow;
    PageHeader: typeof PageHeader;
    SectionHeader: typeof SectionHeader;
  };
  /** Register an extension at runtime (same as {@link defineExtension}). */
  defineExtension: typeof defineExtension;
  /** Resolve the current host platform. */
  getHostPlatform: typeof getHostPlatform;
  /** Resolve the current host info. */
  getHostInfo: typeof getHostInfo;
  /** Read the system clipboard as plain text. */
  readClipboardText: typeof readClipboardText;
  /** Write plain text to the system clipboard. */
  writeClipboardText: typeof writeClipboardText;
  /** Refresh the connected USB device list. */
  refreshUsbDevices: typeof refreshUsbDevices;
  /** Reactive USB device store. */
  usbStore: typeof usbStore;
  /** In-memory store factory. */
  createStore: typeof createStore;
  /** Start capturing the screen. */
  createScreenMonitor: typeof createScreenMonitor;
  /** Stream the screen onto an open channel. */
  startScreenStream: typeof startScreenStream;
  /** Show a toast (works outside React). */
  showToast: typeof showToast;
}

declare global {
  interface Window {
    /** Runtime entry point for installed (zip) extensions. */
    yatouch?: YatouchRuntime;
  }
}

/**
 * Wire the global `window.yatouch` used by installed (zip) extensions.
 * Called once by the shell before loading installed extensions.
 */
export function installBridge(): void {
  window.yatouch = {
    React,
    components: {
      Select,
      ToastProvider,
      useToast,
      Button,
      SettingRow,
      PageHeader,
      SectionHeader,
    },
    defineExtension,
    getHostPlatform,
    getHostInfo,
    readClipboardText,
    writeClipboardText,
    refreshUsbDevices,
    usbStore,
    createStore,
    showToast,
    createScreenMonitor,
    startScreenStream,
  };
}
