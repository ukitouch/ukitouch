// Bundled source of the unified loading pipeline
import { registerExtension } from "../core/registry";
import type { ExtensionDefinition } from "../core/types";

const modules = import.meta.glob<{ default: ExtensionDefinition }>(
  "./*/index.{ts,tsx}",
  { eager: true }
);

for (const mod of Object.values(modules)) {
  if (mod?.default) registerExtension(mod.default);
}