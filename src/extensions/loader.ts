import { invoke } from "@tauri-apps/api/core";
import { registerStyles, unregisterExtension } from "./registry";

interface InstalledExt {
  dir: string;
}

interface ExtensionManifest {
  id: string;
  name?: string;
  version?: string;
  entry?: string;
  style?: string;
  permissions?: string[];
  platforms?: string[];
}

/** Extension ids registered by each loaded directory. */
const loadedIds = new Map<string, string[]>();

export async function loadInstalledExtensions(): Promise<void> {
  const list = await invoke<InstalledExt[]>("list_installed_extensions");
  for (const { dir } of list) await loadExtensionDir(dir);
}

/**
 * Load an extension directory, replacing whatever was loaded from it before.
 *
 * @param dir The extension directory on disk.
 */
export async function loadExtensionDir(dir: string): Promise<void> {
  unloadExtensionDir(dir);

  // manifest
  const manifest = await invoke<ExtensionManifest>("read_extension_manifest", { dir });
  const extId = manifest.id;

  // style sheet
  const styleFile = manifest.style ?? "index.css";
  try {
    const css = await invoke<string>("read_extension_file", { dir, file: styleFile });
    if (css.trim()) registerStyles(extId, css);
  } catch {
    // No CSS file, ignore
  }

  // js
  const entryFile = manifest.entry ?? "index.js";
  const code = await invoke<string>("read_extension_file", {
    dir,
    file: entryFile,
  });
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }

  loadedIds.set(dir, [extId]);
}

/**
 * Unregister every extension loaded from a directory.
 *
 * @param dir The extension directory on disk.
 */
export function unloadExtensionDir(dir: string): void {
  for (const id of loadedIds.get(dir) ?? []) unregisterExtension(id);
  loadedIds.delete(dir);
}
