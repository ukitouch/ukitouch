import { useEffect, useState, useSyncExternalStore } from "react";
import {
  cancelConnect,
  disconnect,
  openPingChannel,
  openUsbPingChannel,
  pingStore,
  sendPing,
} from "./api";
import {
  disableUsbListener,
  enableUsbListener,
  refreshUsbDevices,
  usbListenerStore,
  usbStore,
} from "../../core/usb";
import { getHostPlatform } from "../../core/host";
import type { HostPlatform } from "../../core/types";

export default function PingView() {
  const state = useSyncExternalStore(pingStore.subscribe, pingStore.get);
  const [target, setTarget] = useState("");
  const [platform, setPlatform] = useState<HostPlatform | null>(null);
  const isDesktop = platform === "windows" || platform === "linux";
  const isAndroid = platform === "android";

  useEffect(() => {
    void getHostPlatform().then(setPlatform);
  }, []);

  const status = state.connecting
    ? "connecting"
    : state.peerId
      ? "connected"
      : "idle";

  function onConnectClick() {
    if (status === "connecting") cancelConnect();
    else if (status === "connected") disconnect();
    else void openPingChannel(target.trim());
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold mb-1">Ping</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Template extension
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="target device id"
          className="flex-1 min-w-0 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 font-mono text-sm"
        />
        <button
          onClick={onConnectClick}
          className="bg-gray-700 text-gray-100 rounded-md px-3 py-1.5 hover:bg-gray-600 transition-colors"
        >
          {status === "connecting"
            ? "Cancel"
            : status === "connected"
              ? "Disconnect"
              : "Connect"}
        </button>
        <button
          onClick={sendPing}
          disabled={status !== "connected"}
          className="bg-gray-700 text-gray-100 rounded-md px-3 py-1.5 hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          Ping
        </button>
      </div>

      <pre className="bg-gray-100 dark:bg-gray-800 rounded-md p-3 text-xs h-64 overflow-y-auto whitespace-pre-wrap">
        {state.logs.join("\n")}
      </pre>

      {isDesktop && <DesktopListener />}
      {isAndroid && <AndroidListener />}
    </div>
  );
}

function DesktopListener() {
  const usbDevices = useSyncExternalStore(
    usbStore.subscribe,
    () => usbStore.get().devices
  );

  return (
    <section className="flex flex-col gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">USB Devices</h2>
        <button
          onClick={() => void refreshUsbDevices()}
          className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
        >
          Refresh
        </button>
      </div>
      {usbDevices.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No USB devices (plug in and refresh)
        </p>
      ) : (
        <ul className="space-y-1">
          {usbDevices.map((d) => (
            <li key={d.serial} className="flex items-center gap-2 text-sm">
              <code className="flex-1 truncate text-gray-800 dark:text-gray-200">
                {d.serial}
              </code>
              <span className="text-xs text-gray-500">{d.state}</span>
              <button
                onClick={() => void openUsbPingChannel(d.serial)}
                className="px-2 py-0.5 rounded text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
              >
                Connect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AndroidListener() {
  const enabled = useSyncExternalStore(
    usbListenerStore.subscribe,
    () => usbListenerStore.get().enabled
  );
  return (
    <section className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          USB Listener
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {enabled
            ? "Will accept USB connections from a desktop"
            : "Connection request from desktop will be rejected"}
        </p>
      </div>
      <button
        onClick={() =>
          void (enabled ? disableUsbListener() : enableUsbListener())
        }
        className={`px-3 py-1.5 rounded-md text-sm ${enabled
          ? "bg-gray-700 text-gray-100"
          : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
          }`}
      >
        {enabled ? "Disable" : "Enable"}
      </button>
    </section>
  );
}
