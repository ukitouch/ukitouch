import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { loadInstalledExtensions } from "./core/loader";
import { unregisterExtension } from "./core/registry";
import { useToast } from "./toast";

interface InstalledExt {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  platforms: string[];
  dir: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function ExtensionsManager() {
  const [list, setList] = useState<InstalledExt[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const { show } = useToast();

  const refresh = useCallback(async () => {
    try {
      setList(await invoke<InstalledExt[]>("list_installed_extensions"));
    } catch (e) {
      show(`list failed: ${e}`, "error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function install() {
    const picked = await open({
      title: "Install extension",
      filters: [{ name: "Extension", extensions: ["zip"] }],
    });
    if (!picked) return;
    setInstalling(true);
    try {
      const bytes = await readFile(String(picked));
      const meta = await invoke<InstalledExt>("install_extension", {
        zipBase64: toBase64(bytes),
      });
      await loadInstalledExtensions();
      show(`installed ${meta.name} v${meta.version}`);
      await refresh();
    } catch (e) {
      show(`install failed: ${e}`, "error");
    } finally {
      setInstalling(false);
    }
  }

  async function uninstall(id: string) {
    try {
      await invoke("uninstall_extension", { id });
      unregisterExtension(id);
      show(`uninstalled ${id}`);
      await refresh();
    } catch (e) {
      show(`uninstall failed: ${e}`, "error");
    }
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Extensions</h1>
      <button
        onClick={() => void install()}
        disabled={installing}
        className="self-start px-3 py-1.5 rounded-md text-sm bg-gray-700 hover:bg-gray-600 text-gray-100 disabled:opacity-50"
      >
        {installing ? "Installing…" : "Install extension (.zip)"}
      </button>
      <ul className="flex flex-col gap-2">
        {(list ?? []).map((ext) => (
          <li
            key={ext.id}
            className="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2 text-sm"
          >
            <span>
              {ext.name} <span className="text-gray-400">({ext.id})</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-gray-400">v{ext.version}</span>
              <button
                onClick={() => {
                  if (uninstallConfirm === ext.id) {
                    setUninstallConfirm(null);
                    void uninstall(ext.id);
                  } else {
                    setUninstallConfirm(ext.id);
                  }
                }}
                className={
                  uninstallConfirm === ext.id
                    ? "text-red-500 font-semibold"
                    : "text-gray-400 hover:text-red-500"
                }
              >
                {uninstallConfirm === ext.id ? "Confirm?" : "Uninstall"}
              </button>
            </span>
          </li>
        ))}
        {list && list.length === 0 && (
          <li className="text-sm text-gray-400">No extensions installed.</li>
        )}
      </ul>
    </div>
  );
}
