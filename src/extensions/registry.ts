import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { makeContext } from "../core/transport/net";
import type { NetContext } from "../core/types";

//#region Definition

/**
 * An frontend extension's declaration.
 */
export interface ExtensionDefinition {
  /** Display name (sidebar tooltip, page title). Defaults to `publisher.name`. */
  title?: string;
  /** Sidebar icon. */
  icon?: ReactNode;
  /**
   * Logic layer entry. Called once at app startup, independent of the view
   * lifecycle.
   *
   * @returns a cleanup function
   */
  activate?: (ctx: NetContext) => void | (() => void);
  /** View layer, rendered in the main area when active. */
  component?: ComponentType;
}

/**
 * A definition with its host-side defaults applied and an id attached.
 */
interface RegisteredExtension extends ExtensionDefinition {
  /** publisher.name */
  id: string;
  title: string;
  icon: ReactNode;
  component: ComponentType;
}

/**
 * Fill defaults into a public definition.
 *
 * @param def The definition written by the extension author.
 * @param id The id the manifest gave it.
 * @returns The host-side definition with defaults applied.
 */
function normalize(def: ExtensionDefinition, id: string): RegisteredExtension {
  return {
    id,
    title: def.title ?? id,
    icon: def.icon ?? createElement(Fragment, null),
    component: def.component ?? (() => null),
    activate: def.activate,
  };
}

/** Definition declared by the module currently being loaded. */
let pending: ExtensionDefinition | null = null;

/**
 * A frontend extension should declare itself by calling this.
 */
export function defineExtension(def: ExtensionDefinition): void {
  pending = def;
}

/**
 * Take the definition the module just declared.
 *
 * @returns The declaration, or null when the module declared none.
 */
export function takeExtension(): ExtensionDefinition | null {
  const def = pending;
  pending = null;
  return def;
}

//#endregion
//#region Registry

const registry = new Map<string, RegisteredExtension>();
let activated = false;
let cached: RegisteredExtension[] = [];
let dirty = true;
const listeners = new Set<() => void>();
/** Per-extension cleanup, run on deactivation/uninstall. */
const cleanups = new Map<string, () => void>();

export function registerExtension(
  def: ExtensionDefinition,
  id: string
): RegisteredExtension {
  if (registry.has(id)) {
    throw new Error(`duplicate extension id: ${id}`);
  }

  const normalized = normalize(def, id);
  registry.set(id, normalized);
  dirty = true;
  listeners.forEach((l) => l());
  // An extension registered after activateExtensions() has already run
  // (e.g. installed ones loaded asynchronously from disk) still needs its
  // context handed over. Activate it immediately on registration.
  if (activated) activateOne(normalized);
  return normalized;
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

export function listExtensions(): RegisteredExtension[] {
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
function activateOne(def: RegisteredExtension): void {
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
function removeStyles(extId: string): void {
  const el = styleMap.get(extId);
  if (el) {
    el.remove();
    styleMap.delete(extId);
  }
}

//#endregion