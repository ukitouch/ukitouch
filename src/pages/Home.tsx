import { useEffect, useState, useSyncExternalStore } from "react";
import { disableTempId, enableTempId, tempIdStore } from "../core/p2p";
import {
  disableUsbListener,
  enableUsbListener,
  usbListenerStore,
} from "../core/usb";
import { getHostPlatform } from "../core/host";
import type { HostPlatform } from "../core/types";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { SettingRow } from "../components/SettingRow";

async function copyText(text: string): Promise<void> {
  try {
    await import("@tauri-apps/plugin-clipboard-manager").then((m) =>
      m.writeText(text),
    );
    return;
  } catch {
    // fall back to the Web Clipboard API for plain-browser dev
  }
  if (!navigator.clipboard) throw new Error("clipboard unavailable");
  await navigator.clipboard.writeText(text);
}

function HomePage() {
  const tmpEnabled = useSyncExternalStore(
    tempIdStore.subscribe,
    () => tempIdStore.get().enabled
  );
  const tempId = useSyncExternalStore(
    tempIdStore.subscribe,
    () => tempIdStore.get().id ?? "---------"
  );
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    try {
      if (tmpEnabled) {
        await disableTempId();
      } else {
        await enableTempId();
      }
    } catch (e) {
      console.error("[tempid] toggle failed", e);
    } finally {
      window.setTimeout(() => setToggling(false), 500);
    }
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <PageHeader title="YATouch" />

      <SettingRow
        label="Temporary ID"
        action={
          <Button
            variant={tmpEnabled ? "primary" : "ghost"}
            disabled={toggling}
            onClick={() => void toggle()}
          >
            {tmpEnabled ? "Hide" : "Show"}
          </Button>
        }
      >
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2">
          <code className="flex-1 break-all text-sm text-gray-700 dark:text-gray-300">
            {tempId.replace(/(.{3})(?=.)/g, "$1 ")}
          </code>
          {tmpEnabled ? (
            copied ? (
              <svg
                className="text-gray-400 dark:text-gray-500"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                className="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer"
                onClick={async () => {
                  await copyText(tempId);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
                aria-label="Copy temporary ID"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )
          ) : (
            <></>
          )}
        </div>
      </SettingRow>

      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {tmpEnabled
            ? "Anyone with this ID can reach you."
            : "Only known contacts can reach you."}
        </span>
      </div>

      <UsbListenerSection />
    </div>
  );
}

/**
 * Android-only USB listener toggle.
 */
function UsbListenerSection() {
  const [platform, setPlatform] = useState<HostPlatform | null>(null);
  useEffect(() => {
    void getHostPlatform().then(setPlatform);
  }, []);

  const enabled = useSyncExternalStore(
    usbListenerStore.subscribe,
    () => usbListenerStore.get().enabled
  );
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    try {
      if (enabled) await disableUsbListener();
      else await enableUsbListener();
    } catch (e) {
      console.error("[usb] listener toggle failed", e);
    } finally {
      window.setTimeout(() => setToggling(false), 500);
    }
  }

  if (platform !== "android") return null;

  return (
    <SettingRow
      label="USB Listener"
      action={
        <Button
          variant={enabled ? "primary" : "ghost"}
          disabled={toggling}
          onClick={() => void toggle()}
        >
          {enabled ? "Disable" : "Enable"}
        </Button>
      }
      hint="USB debugging must be enabled for a desktop to find this device"
    >
      <div className="bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {enabled
            ? "Will accept USB connections from a desktop"
            : "Connection request from desktop will be rejected"}
        </span>
      </div>
    </SettingRow>
  );
}

export default HomePage;
