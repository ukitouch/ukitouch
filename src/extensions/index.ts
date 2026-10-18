import * as React from "react";
import { components } from "../api/components";
import { createScreenMonitor, startScreenStream } from "../api/media";
import { injectInput, releaseInput, startInput, stopInput } from "../api/input";
import { showToast } from "../components/Toast";
import { getHostInfo } from "../core/hostinfo";
import { refreshUsbDevices, usbStore } from "../core/transport/usb";
import { createStore } from "../core/utils/store";
import { setFullscreen } from "../core/utils/ui";
import { defineExtension } from "./registry";

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
  /** Start capturing the screen. */
  createScreenMonitor,
  /** Stream the screen onto an open channel. */
  startScreenStream,
  /** Bring the input backend up. */
  startInput,
  /** Synthesize a batch of input events. */
  injectInput,
  /** Release everything the backend is holding down. */
  releaseInput,
  /** Release and drop the input backend. */
  stopInput,
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

// Bundled extensions register themselves via defineExtension() when their
// module is evaluated. Eagerly importing them here triggers that side effect.
void import.meta.glob("./*/index.{ts,tsx}", { eager: true });
