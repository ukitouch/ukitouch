/**
 * Public extension API.
 *
 * Extensions code against this module. Bundled extensions import it directly;
 * installed (zip) extensions use the same surface at runtime through `window.yatouch`.
 */
import * as React from "react";
import { getHostInfo } from "../core/hostinfo";
import { setFullscreen } from "../core/utils/ui";
import { createStore } from "../core/utils/store";
import { refreshUsbDevices, usbStore } from "../core/transport/usb";
import { showToast } from "../components/Toast";
import { createScreenMonitor, startScreenStream } from "./media";
import { injectInput, releaseInput, startInput, stopInput } from "./input";
import { toDisposable } from "../core/types";
import type { NetContext, Platform, Layout, Disposable } from "../core/types";
import type { DeviceRecord } from "../core/db";
import type { Channel, OpenSpec } from "../core/transport";

export { React };
export * from "./components";
export { defineExtension } from "../extensions/registry";
export type { ExtensionDefinition } from "../extensions/registry";

export {
  getHostInfo,
  setFullscreen,
  refreshUsbDevices,
  usbStore,
  createStore,
  showToast,
  createScreenMonitor,
  startScreenStream,
  startInput,
  injectInput,
  releaseInput,
  stopInput,
  toDisposable,
};

export type {
  NetContext,
  Platform,
  Layout,
  Disposable,
  Channel,
  OpenSpec,
  DeviceRecord,
};

export type {
  Damage,
  DamageFrame,
  ScreenInfo,
  ScreenMonitor,
  ScreenStream,
  StartResult,
  CaptureFailure,
  CaptureOptions,
  StreamOptions,
  ScreenSize,
  Cursor,
} from "./media";

export type { SearchOption } from "../components/SearchSelect";
export type { SelectOption } from "../components/Select";
export type { UsbDevice } from "../core/transport/usb";
export type { InputEvent, MouseButton, Point } from "./input";
export type { Store } from "../core/utils/store";
export type { ToastKind } from "../components/Toast";
export type { PinchTransform, PinchAreaProps } from "../components/PinchArea";
