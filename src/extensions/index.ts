import * as React from "react";
import { components } from "../api/components";
import { nativeCall, pipeBind, pipeUnbind } from "../api/extensions";
import { showToast } from "../components/Toast";
import { getHostInfo } from "../core/hostinfo";
import { refreshUsbDevices, usbStore } from "../core/transport/usb";
import { createStore } from "../core/utils/store";
import { setFullscreen } from "../core/utils/ui";
import { defineExtension, registerExtension, takeExtension } from "./registry";

export { defineExtension };
export type { ExtensionDefinition } from "./registry";

/** Runtime API exposed to installed (zip) extensions on `window.yatouch`. */
const runtime = {
  /** React instance for building views. */
  React,
  /** Shared UI components reusable by extensions. */
  components,
  /** Register an extension at runtime. */
  defineExtension,
  /** Resolve the current host info. */
  getHostInfo,
  /** Hold the app fullscreen (Android only). */
  setFullscreen,
  /** Refresh the connected USB device list. */
  refreshUsbDevices,
  /** Reactive USB device store. */
  usbStore,
  /** In-memory store factory. */
  createStore,
  /** Show a toast (works outside React). */
  showToast,
  /** Call a method on a native extension. */
  nativeCall,
  /** Bridge an extension's pipe address into a P2P channel. */
  pipeBind,
  /** Close a pipe. */
  pipeUnbind,
};

export type YatouchRuntime = typeof runtime;

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
  window.yatouch = runtime;
}

// Bundled extensions declare themselves via defineExtension() when their
// module is evaluated.
const bundled = import.meta.glob("./*/index.{ts,tsx}");

/**
 * Load the built-in extensions.
 */
export async function loadBundledExtensions(): Promise<void> {
  for (const [path, load] of Object.entries(bundled)) {
    const id = path.split("/")[1];  // TODO: or compose via manifest?
    await load();
    const def = takeExtension();
    if (!def) {
      console.error(`[ext] ${id}: did not define an extension`);
      continue;
    }
    registerExtension(def, id);
  }
}
