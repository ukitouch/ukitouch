import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { loadExtensionDir, unloadExtensionDir } from "../extensions/loader";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Confirm";
import { Button } from "../api";

interface InstalledExt {
  id: string;
  name: string;
  version: string;
  dir: string;
}

type InstallOutcome =
  | { status: "installed"; meta: InstalledExt }
  | { status: "overrideConfirm"; id: string; existingVersion: string; incomingVersion: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function ExtensionsManager() {
  const [list, setList] = useState<InstalledExt[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const { show } = useToast();
  const confirm = useConfirm();

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
      const bytes = await readFile(picked);
      const zipBase64 = toBase64(bytes);
      let outcome = await invoke<InstallOutcome>("install_extension", {
        zipBase64,
        force: false,
      });

      if (outcome.status === "overrideConfirm") {
        const ok = await confirm({
          title: "Overwrite extension",
          message: outcome.existingVersion
            ? `${outcome.id} v${outcome.existingVersion} is installed. Overwrite with v${outcome.incomingVersion}?`
            : `${outcome.id} is already installed. Overwrite with v${outcome.incomingVersion}?`,
          confirmText: "Overwrite",
          confirmStyle: "dangerFill",
        });

        if (!ok) return;
        outcome = await invoke<InstallOutcome>("install_extension", {
          zipBase64,
          force: true,
        });
      }

      if (outcome.status !== "installed") return;
      await loadExtensionDir(outcome.meta.dir);
      show(`installed ${outcome.meta.name} v${outcome.meta.version}`);
      await refresh();
    } catch (e) {
      show(`install failed: ${e}`, "error");
    } finally {
      setInstalling(false);
    }
  }

  async function uninstall(ext: InstalledExt) {
    const ok = await confirm({
      title: "Uninstall extension",
      message: `Uninstall ${ext.name}?`,
      confirmText: "Uninstall",
      confirmStyle: "dangerFill",
    });
    if (!ok) return;
    try {
      await invoke("uninstall_extension", { id: ext.id });
      unloadExtensionDir(ext.dir);
      show(`uninstalled ${ext.id}`);
      await refresh();
    } catch (e) {
      show(`uninstall failed: ${e}`, "error");
    }
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Extensions</h1>
      <Button
        onClick={() => void install()}
        disabled={installing}
        className="self-start"
      >
        {installing ? "Installing…" : "Install extension (.zip)"}
      </Button>
      <ul className="flex flex-col gap-2">
        {(list ?? []).map((ext) => (
          <li
            key={ext.id}
            className="flex items-center justify-between rounded-md px-3 py-2 text-sm bg-box"
          >
            <span>{ext.name}</span>
            <span className="flex items-center gap-2">
              <span className="text-3">v{ext.version}</span>
              <button
                onClick={() => void uninstall(ext)}
                className="interactive-text-danger"
              >
                Uninstall
              </button>
            </span>
          </li>
        ))}
        {list && list.length === 0 && (
          <li className="text-sm text-3">No extensions installed.</li>
        )}
      </ul>
    </div>
  );
}
