import { defineExtension, registerExtension, takeExtension } from "./registry";
import type { ExtensionManifest } from "./loader";

export { defineExtension };
export type { ExtensionDefinition } from "./registry";

// Bundled extensions declare themselves via defineExtension() when their
// module is evaluated.
const manifests = import.meta.glob("./*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, ExtensionManifest>;
const bundled = import.meta.glob("./*/index.{ts,tsx}");

/**
 * Load the built-in extensions.
 */
export async function loadBundledExtensions(): Promise<void> {
  for (const [path, load] of Object.entries(bundled)) {
    const dir = path.split("/")[1];
    const manifest = manifests[`./${dir}/manifest.json`];
    if (!manifest) {
      console.error(`[ext] ${dir}: no manifest.json`);
      continue;
    }
    const id = `${manifest.publisher}.${manifest.name}`;
    await load();
    const def = takeExtension();
    if (!def) {
      console.error(`[ext] ${id}: did not define an extension`);
      continue;
    }
    registerExtension(def, id);
  }
}
