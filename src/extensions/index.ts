import * as React from "react";
import { components } from "../api/components";
import { nativeCall } from "../api/extensions";
import { showToast } from "../components/Toast";
import { getHostInfo } from "../core/hostinfo";
import { refreshUsbDevices, usbStore } from "../core/transport/usb";
import { createStore } from "../core/utils/store";
import { setFullscreen } from "../core/utils/ui";
import { defineExtension, registerExtension, takeExtension } from "./registry";
import type { ExtensionManifest } from "./loader";

export { defineExtension };
export type { ExtensionDefinition } from "./registry";

/** Runtime API exposed to installed (zip) extensions on `window.ukitouch`. */
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
};

export type UkitouchRuntime = typeof runtime;

declare global {
  interface Window {
    /** Runtime entry point for installed (zip) extensions. */
    ukitouch?: UkitouchRuntime;
  }
}

/**
 * Wire the global `window.ukitouch` used by installed (zip) extensions.
 * Called once by the shell before loading installed extensions.
 */
export function installBridge(): void {
  window.ukitouch = runtime;
}

// Bundled extensions declare themselves via defineExtension() when their
// module is evaluated.
const manifests = import.meta.glob("./*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, ExtensionManifest>;
const bundled = import.meta.glob("./*/index.{ts,tsx}");

/**
 * Load the built-in extensions.
 */
export async function loadBundledExtensions(): Promise<void> {
  for (const [path, load] of Object.entries(bundled)) {
    const dir = path.split("/")[1];
    const manifest = manifests[`./${dir}/manifest.json`];
    if (!manifest) {
      console.error(`[ext] ${dir}: no manifest.json`);
      continue;
    }
    const id = `${manifest.publisher}.${manifest.name}`;
    await load();
    const def = takeExtension();
    if (!def) {
      console.error(`[ext] ${id}: did not define an extension`);
      continue;
    }
    registerExtension(def, id);
  }
}
