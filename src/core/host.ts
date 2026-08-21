import type { ExtensionContext, Layout } from "./types";

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
