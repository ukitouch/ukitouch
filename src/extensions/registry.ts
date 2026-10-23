import * as React from "react";
import { makeContext } from "../core/transport/net";
import type { NetContext, Platform } from "../core/types";

//#region Definition

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
  platforms?: Platform[];
  /**
   * Logic layer entry. Called once at app startup, independent of the view
   * lifecycle.
   *
   * @returns a cleanup function
   */
  activate?: (ctx: NetContext) => void | (() => void);
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
function normalize(def: ExtensionDefinition): ExtensionDefinition {
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
): ExtensionDefinition {
  const normalized = normalize(def);
  registerExtension(normalized);
  return normalized;
}

//#endregion
//#region Registry

const registry = new Map<string, ExtensionDefinition>();
let activated = false;
let cached: ExtensionDefinition[] = [];
let dirty = true;
const listeners = new Set<() => void>();
/** Per-extension cleanup, run on deactivation/uninstall. */
const cleanups = new Map<string, () => void>();

export function registerExtension(
  def: ExtensionDefinition
): ExtensionDefinition {
  if (registry.has(def.id)) {
    throw new Error(`duplicate extension id: ${def.id}`);
  }

  registry.set(def.id, def);
  dirty = true;
  listeners.forEach((l) => l());
  // An extension registered after activateExtensions() has already run
  // (e.g. installed ones loaded asynchronously from disk) still needs its
  // context handed over. Activate it immediately on registration.
  if (activated) activateOne(def);
  return def;
}

/**
 * Remove an extension and run its cleanup (disposing its subscriptions).
 *
 * @param id The extension id to remove.
 */
export function unregisterExtension(id: string): void {
  cleanups.get(id)?.();
  cleanups.delete(id);
  removeStyles(id);
  if (registry.delete(id)) {
    dirty = true;
    listeners.forEach((l) => l());
  }
}

export function listExtensions(): ExtensionDefinition[] {
  if (dirty) {
    cached = [...registry.values()];
    dirty = false;
  }
  return cached;
}

/**
 * Subscribe to registry changes.
 *
 * @param cb Called whenever the extension set changes.
 * @returns An unsubscribe function.
 */
export function subscribeExtensions(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

//#endregion
//#region Activation

/**
 * Activate a single extension.
 *
 * @param def The extension to activate.
 */
function activateOne(def: ExtensionDefinition): void {
  const ctx = makeContext(def.id);
  let cleanup: void | (() => void) | undefined;

  try {
    cleanup = def.activate?.(ctx);
  } catch (e) {
    // This error is caused by extension itself.
    console.error(`[ext] activate failed: ${def.id}`, e);
  }

  cleanups.set(def.id, () => {
    for (const d of ctx.subscriptions) d.dispose();
    if (typeof cleanup === "function") cleanup();
  });
}

/**
 * Run every registered extension's logic layer.
 */
export function activateExtensions(): void {
  if (activated) return;
  activated = true;
  for (const ext of registry.values()) activateOne(ext);
}

//#endregion
//#region Styles Registry

const styleMap = new Map<string, HTMLStyleElement>();

/**
 * Register CSS styles for an extension.
 * 
 * Automatically replaces any previously registered styles for the same extension.
 */
export function registerStyles(extId: string, css: string): void {
  removeStyles(extId);

  const el = document.createElement("style");
  el.dataset.ext = extId;
  el.textContent = css;
  document.head.appendChild(el);
  styleMap.set(extId, el);
}

/**
 * Remove styles registered by an extension.
 */
export function removeStyles(extId: string): void {
  const el = styleMap.get(extId);
  if (el) {
    el.remove();
    styleMap.delete(extId);
  }
}

//#endregion