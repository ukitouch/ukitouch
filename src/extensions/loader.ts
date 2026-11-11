import { invoke } from "@tauri-apps/api/core";
import {
  registerExtension,
  registerStyles,
  takeExtension,
  unregisterExtension,
} from "./registry";

interface InstalledExt {
  dir: string;
}

export interface ExtensionManifest {
  publisher: string;
  name: string;
  version: string;
  kind: "frontend" | "native";
  entry: string;
  style?: string;
  requires?: ExtensionRequirement[];
}

/** An extension this one needs. */
export interface ExtensionRequirement {
  publisher: string;
  name: string;
  url?: string | null;
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
  const extId = `${manifest.publisher}.${manifest.name}`;

  // native sidecars are started by the host, nothing to load here
  if (manifest.kind === "native") {
    loadedIds.set(dir, []);
    return;
  }

  // style sheet
  if (manifest.style) {
    try {
      const css = await invoke<string>("read_extension_file", {
        dir,
        file: manifest.style,
      });
      if (css.trim()) registerStyles(extId, css);
    } catch {
      // No CSS file, ignore
    }
  }

  // js
  const code = await invoke<string>("read_extension_file", {
    dir,
    file: manifest.entry,
  });
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  let def;
  try {
    await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
    def = takeExtension();
  }
  if (!def) throw new Error(`${extId}: did not define an extension`);
  registerExtension(def, extId);

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
