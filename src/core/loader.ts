import { invoke } from "@tauri-apps/api/core";
import { listExtensions, unregisterExtension } from "../extensions/registry";

interface InstalledExt {
  dir: string;
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
  const before = new Set(registryIds());
  const code = await invoke<string>("read_extension_script", {
    dir,
  });
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
  loadedIds.set(
    dir,
    registryIds().filter((id) => !before.has(id))
  );
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

function registryIds(): string[] {
  return listExtensions().map((ext) => ext.id);
}
