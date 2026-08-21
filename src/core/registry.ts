import { makeContext } from "./net";
import type { ExtensionDefinition } from "./types";

const registry = new Map<string, ExtensionDefinition>();
let activated = false;

export function registerExtension(
  def: ExtensionDefinition
): ExtensionDefinition {
  if (registry.has(def.id)) {
    throw new Error(`duplicate extension id: ${def.id}`);
  }
  registry.set(def.id, def);
  return def;
}

export function listExtensions(): ExtensionDefinition[] {
  return [...registry.values()];
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
