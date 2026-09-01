import type { ComponentType } from "react";
import type { ExtensionContext } from "../core/types";

export type { ExtensionContext };

/** Registered via defineExtension. */
export interface ExtensionDef {
  id: string;
  view: ComponentType;
  activate?: (api: ExtensionContext) => void | (() => void);
}

/** Register an extension. */
export function defineExtension(def: ExtensionDef): void {
  window.__extRegistry?.register(def);
}

declare global {
  interface Window {
    __extRegistry?: { register(def: ExtensionDef): void };
  }
}
