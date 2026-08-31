import { makeContext } from "./net";
import type { ExtensionDefinition } from "./types";

const registry = new Map<string, ExtensionDefinition>();
let activated = false;
let cached: ExtensionDefinition[] = [];
let dirty = true;
const listeners = new Set<() => void>();

export function registerExtension(
  def: ExtensionDefinition
): ExtensionDefinition {
  if (registry.has(def.id)) {
    throw new Error(`duplicate extension id: ${def.id}`);
  }
  registry.set(def.id, def);
  dirty = true;
  listeners.forEach((l) => l());
  return def;
}

export function unregisterExtension(id: string): void {
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

export function subscribeExtensions(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Identity helper for extension modules. */
export function defineExtension(def: ExtensionDefinition): ExtensionDefinition {
  return def;
}

/** Run every extension's logic layer. */
export function activateExtensions(): void {
  if (activated) return;
  activated = true;
  for (const ext of registry.values()) {
    ext.activate?.(makeContext(ext.id));
  }
}
