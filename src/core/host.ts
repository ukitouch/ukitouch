import { invoke } from "@tauri-apps/api/core";
import type { ExtensionContext, HostPlatform, Layout } from "./types";

/** Toast severity. */
export type ToastKind = "info" | "error";

let setLayoutImpl: (layout: Layout) => void = () => {
  // no-op until the shell binds its React state
};

/** The shell-provided slice of the extension context (see net.makeContext). */
export const hostCapabilities: Pick<ExtensionContext, "setLayout"> = {
  setLayout: (layout) => setLayoutImpl(layout),
};

/** Called by the shell to wire host capabilities to React state. */
export function bindHost(impl: { setLayout: (layout: Layout) => void }): void {
  setLayoutImpl = impl.setLayout;
}

let toastImpl: ((message: string, kind?: ToastKind) => void) | null = null;

/**
 * The React toast provider registers here.
 *
 * @param fn The toast function, or `null` to unregister.
 */
export function setToastSink(fn: ((message: string, kind?: ToastKind) => void) | null): void {
  toastImpl = fn;
}

/**
 * Show a toast if a sink is wired.
 *
 * @param message The message to show.
 * @param kind The severity, defaults to "info".
 */
export function showToast(message: string, kind?: ToastKind): void {
  toastImpl?.(message, kind);
}

let platformPromise: Promise<HostPlatform> | null = null;

/** Detect the current host platform, resolved once and cached. */
export function getHostPlatform(): Promise<HostPlatform> {
  platformPromise ??= invoke<string>("get_platform").then(
    (p) => p as HostPlatform
  );
  return platformPromise;
}

/**
 * Hold the app fullscreen.
 *
 * Android only: the command rejects elsewhere, where the window belongs to the
 * user.
 *
 * @param enabled Whether to hold the fullscreen mode.
 */
export async function setFullscreen(enabled: boolean): Promise<void> {
  await invoke("set_fullscreen", { enabled });
}
