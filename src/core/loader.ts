import { invoke } from "@tauri-apps/api/core";

interface InstalledExt {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  platforms: string[];
  dir: string;
}

export async function loadInstalledExtensions(): Promise<void> {
  const list = await invoke<InstalledExt[]>("list_installed_extensions");
  await Promise.all(list.map(loadOne));
}

async function loadOne(ext: InstalledExt): Promise<void> {
  const code = await invoke<string>("read_extension_file", {
    dir: ext.dir,
    file: "index.js",
  });
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  await import(/* @vite-ignore */ url);
  URL.revokeObjectURL(url);
}
