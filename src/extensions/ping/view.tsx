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
  refreshUsbDevices,
  usbStore,
} from "../../core/usb";
import { Select } from "../../components/Select";
import { getHostPlatform } from "../../core/host";
import type { HostPlatform } from "../../core/types";

export default function PingView() {
  const state = useSyncExternalStore(pingStore.subscribe, pingStore.get);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"webrtc" | "usb" | "ble">("webrtc");
  const [serial, setSerial] = useState("");
  const usbDevices = useSyncExternalStore(
    usbStore.subscribe,
    () => usbStore.get().devices
  );
  const [platform, setPlatform] = useState<HostPlatform | null>(null);
  const isDesktop = platform === "windows" || platform === "linux";

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

  function onUsbConnectClick() {
    if (status === "connecting") cancelConnect();
    else if (status === "connected") disconnect();
    else {
      const target = serial || usbDevices[0]?.serial;
      if (target) void openUsbPingChannel(target);
    }
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold mb-1">Ping</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Template extension
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-md p-1 w-fit">
        {(["webrtc", "usb", "ble"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${mode === m
              ? "bg-gray-700 text-gray-100"
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
          >
            {m === "webrtc" ? "WebRTC" : m === "usb" ? "USB" : "BLE"}
          </button>
        ))}
      </div>

      {mode === "webrtc" ? (
        <div className="flex flex-wrap gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="target device id"
            className="flex-1 min-w-40 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 font-mono text-sm"
          />
          <div className="flex gap-2">
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
        </div>
      ) : mode === "usb" ? (
        isDesktop ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {usbDevices.length > 0 && (
                <Select
                  value={serial}
                  options={usbDevices.map((d) => ({
                    value: d.serial,
                    label: `${d.serial}  (${d.state})`,
                  }))}
                  onChange={setSerial}
                  ariaLabel="USB device"
                />
              )}
              {usbDevices.length === 0 && (
                <p className="flex-1 text-xs text-gray-500 dark:text-gray-400">
                  No USB devices (plug in with USB debugging on, then refresh)
                </p>
              )}
              <button
                onClick={() => void refreshUsbDevices()}
                className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md px-3 py-2 text-sm"
              >
                Refresh
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onUsbConnectClick}
                disabled={usbDevices.length === 0}
                className="bg-gray-700 text-gray-100 rounded-md px-3 py-1.5 hover:bg-gray-600 disabled:opacity-40 transition-colors"
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
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            USB dialing is only available on desktop. Just wait for the host
          </p>
        )
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          BLE transport is not implemented yet
        </p>
      )}

      <pre className="bg-gray-100 dark:bg-gray-800 rounded-md p-3 text-xs h-64 overflow-y-auto whitespace-pre-wrap">
        {state.logs.join("\n")}
      </pre>
    </div>
  );
}


