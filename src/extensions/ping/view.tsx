import { useEffect, useState, useSyncExternalStore } from "react";
import {
  cancelConnect,
  disconnect,
  openPingChannel,
  openPingChannelByUuid,
  openUsbPingChannel,
  pingStore,
  sendPing,
} from "./api";
import {
  Button,
  getHostPlatform,
  PageHeader,
  refreshUsbDevices,
  Select,
  type HostPlatform,
  usbStore,
} from "../../api";

export default function PingView() {
  const state = useSyncExternalStore(pingStore.subscribe, pingStore.get);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
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

  const q = query.trim().toLowerCase();
  const filteredDevices =
    q === ""
      ? state.devices
      : state.devices.filter((d) =>
        (d.remark ?? d.name ?? "").toLowerCase().includes(q)
      );
  const showNewDevice = q !== "" && filteredDevices.length === 0;
  const canConnect = selectedUuid !== null || query.trim() !== "";

  function onWebrtcConnect() {
    if (status === "connecting") cancelConnect();
    else if (status === "connected") disconnect();
    else if (selectedUuid) {
      const dev = state.devices.find((d) => d.uuid === selectedUuid);
      if (dev) {
        const label = dev.remark ?? dev.name ?? "Unknown device";
        void openPingChannelByUuid(dev.uuid, label);
      }
    } else if (query.trim()) {
      void openPingChannel(query.trim());
    }
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
      <PageHeader title="Ping" subtitle="Template extension" />

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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-40">
              {open ? (
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedUuid(null);
                  }}
                  onBlur={() => setOpen(false)}
                  placeholder="Select a device or enter a temp id"
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedUuid) {
                      setQuery("");
                      setSelectedUuid(null);
                    }
                    setOpen(true);
                  }}
                  className="w-full flex items-center text-left truncate rounded-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300"
                >
                  {selectedUuid ? (
                    <span className="max-w-full truncate rounded bg-gray-200 dark:bg-gray-700 px-1.5">
                      {query.trim()}
                    </span>
                  ) : (
                    (query.trim() || "Select a device or enter a temp id")
                  )}
                </button>
              )}
              {open && (
                <div className="absolute top-full left-0 z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md bg-gray-100 dark:bg-gray-800 shadow-lg border border-gray-300 dark:border-gray-700 py-1">
                  {filteredDevices.length === 0 && !showNewDevice && (
                    <div className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                      No known devices yet.
                    </div>
                  )}
                  {filteredDevices.map((d) => {
                    const label = d.remark ?? d.name ?? "Unknown device";
                    return (
                      <button
                        key={d.uuid}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedUuid(d.uuid);
                          setQuery(label);
                          setOpen(false);
                        }}
                        className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      >
                        <span className="truncate">{label}</span>
                        <span className="ml-1 text-xs text-gray-500">
                          {d.platform ?? ""}
                        </span>
                      </button>
                    );
                  })}
                  {showNewDevice && (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedUuid(null);
                        setOpen(false);
                      }}
                      className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      Connect to new device{" "}
                      <code className="font-mono text-xs">{query.trim()}</code>
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={onWebrtcConnect}
                disabled={status === "idle" && !canConnect}
              >
                {status === "connecting"
                  ? "Cancel"
                  : status === "connected"
                    ? "Disconnect"
                    : "Connect"}
              </Button>
              <Button
                onClick={sendPing}
                disabled={status !== "connected"}
              >
                Ping
              </Button>
            </div>
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
              <Button
                variant="ghost"
                onClick={() => void refreshUsbDevices()}
              >
                Refresh
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={onUsbConnectClick}
                disabled={usbDevices.length === 0}
              >
                {status === "connecting"
                  ? "Cancel"
                  : status === "connected"
                    ? "Disconnect"
                    : "Connect"}
              </Button>
              <Button
                onClick={sendPing}
                disabled={status !== "connected"}
              >
                Ping
              </Button>
            </div>
          </div>
        ) : status === "idle" ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            USB dialing is only available on desktop. Just wait for the host
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (status === "connecting") cancelConnect();
                else if (status === "connected") disconnect();
              }}
            >
              {status === "connecting" ? "Cancel" : "Disconnect"}
            </Button>
            <Button
              onClick={sendPing}
              disabled={status !== "connected"}
            >
              Ping
            </Button>
          </div>
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
