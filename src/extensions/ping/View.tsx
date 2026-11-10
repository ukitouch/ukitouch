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
  PageHeader,
  PeerDeviceSearch,
  refreshUsbDevices,
  type Platform,
  UsbDeviceSelect,
  usbStore,
  getHostInfo,
} from "../../api";

type Mode = "webrtc" | "usb" | "ble";

export default function PingView() {
  const state = useSyncExternalStore(pingStore.subscribe, pingStore.get);
  const [mode, setMode] = useState<Mode>("webrtc");
  const [query, setQuery] = useState("");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [usbSerial, setUsbSerial] = useState("");
  const usbDevices = useSyncExternalStore(
    usbStore.subscribe,
    () => usbStore.get().devices
  );

  const [platform, setPlatform] = useState<Platform | null>(null);
  const isDesktop = platform === "windows" || platform === "linux";

  const status = state.connection.status;
  const canConnect = selectedUuid !== null || query.trim() !== "";

  useEffect(() => {
    void getHostInfo().then((i) => setPlatform(i.platform));
  }, []);

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
      const target = usbSerial || usbDevices[0]?.serial;
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
            <PeerDeviceSearch
              devices={state.devices}
              selectedUuid={selectedUuid}
              text={query}
              onTextChange={(text) => {
                setQuery(text);
                setSelectedUuid(null);
              }}
              onSelect={(uuid, label) => {
                setSelectedUuid(uuid);
                setQuery(label);
              }}
              onCreate={(id) => {
                setSelectedUuid(null);
                setQuery(id);
              }}
            />
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
                <UsbDeviceSelect
                  devices={usbDevices}
                  value={usbSerial}
                  onChange={setUsbSerial}
                />
              )}
              {usbDevices.length === 0 && (
                <p className="flex-1 text-xs text-gray-500 dark:text-gray-400">
                  No USB devices (plug in with USB debugging on, then refresh)
                </p>
              )}
              <Button
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
