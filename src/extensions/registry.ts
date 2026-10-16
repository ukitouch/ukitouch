import { ExtensionDefinition } from "../api";
import { makeContext } from "../core/net";

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
