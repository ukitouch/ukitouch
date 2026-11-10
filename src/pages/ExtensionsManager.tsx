import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { loadExtensionDir, unloadExtensionDir } from "../extensions/loader";
import type { ExtensionRequirement } from "../extensions/loader";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Confirm";
import { Button } from "../api";

interface InstalledExt {
  id: string;
  name: string;
  version: string;
  dir: string;
  requires: ExtensionRequirement[];
}

type DepStatus = "ok" | "missing";

type InstallOutcome =
  | { status: "installed"; meta: InstalledExt }
  | { status: "overrideConfirm"; id: string; existingVersion: string; incomingVersion: string };

function depStatus(dep: ExtensionRequirement, installed: Map<string, InstalledExt>): DepStatus {
  return installed.has(`${dep.publisher}.${dep.name}`) ? "ok" : "missing";
}

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

  async function openUrl(url: string) {
    try {
      await invoke("open_url", { url });
    } catch (e) {
      show(`open failed: ${e}`, "error");
    }
  }

  const installedById = new Map((list ?? []).map((ext) => [ext.id, ext]));

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
        {(list ?? []).map((ext) => {
          const deps = (ext.requires ?? [])
            .map((dep) => ({ dep, status: depStatus(dep, installedById) }))
            .filter(({ status }) => status !== "ok");

          return (
            <li
              key={ext.id}
              className="flex flex-col gap-1 rounded-md px-3 py-2 text-sm bg-box"
            >
              <div className="flex items-center justify-between">
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
              </div>
              {deps.map(({ dep }) => {
                const url = dep.url;
                return (
                  <div
                    key={`${dep.publisher}.${dep.name}`}
                    className="flex items-center justify-between text-3"
                  >
                    <span>
                      requires {dep.publisher}.{dep.name}
                    </span>
                    {url && (
                      <button
                        onClick={() => void openUrl(url)}
                        className="link-text"
                      >
                        Download
                      </button>
                    )}
                  </div>
                );
              })}
            </li>
          );
        })}
        {list && list.length === 0 && (
          <li className="text-sm text-3">No extensions installed.</li>
        )}
      </ul>
    </div>
  );
}
