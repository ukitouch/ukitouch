import { invoke } from "@tauri-apps/api/core";
import type { NetContext, Layout } from "../types";

let setLayoutImpl: (layout: Layout) => void = () => {
  // no-op until the shell binds its React state
};

/** The shell-provided slice of the extension context (see net.makeContext). */
export const hostCapabilities: Pick<NetContext, "setLayout"> = {
  setLayout: (layout) => setLayoutImpl(layout),
};

/** Called by the shell to wire host capabilities to React state. */
export function bindLayout(impl: { setLayout: (layout: Layout) => void }): void {
  setLayoutImpl = impl.setLayout;
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
