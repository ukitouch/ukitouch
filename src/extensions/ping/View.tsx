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
  UsbDevice,
} from "@ukitouch/extension";

type Mode = "webrtc" | "usb" | "ble";

export default function PingView() {
  const state = useSyncExternalStore(pingStore.subscribe, pingStore.get);
  const [mode, setMode] = useState<Mode>("webrtc");
  const [query, setQuery] = useState("");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [usbDevice, setUsbDevice] = useState<UsbDevice | null>(null);
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
      void openUsbPingChannel(usbDevice ?? undefined);
    }
  }

  function Webrtc() {
    return (
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
              onWebrtcConnect();
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
    )
  }

  function Usb() {
    function Desktop() {
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {usbDevices.length > 0 && (
              <UsbDeviceSelect
                devices={usbDevices}
                value={usbDevice?.serial}
                onChange={setUsbDevice}
              />
            )}
            {usbDevices.length === 0 && (
              <p className="flex-1 text-xs text-3">
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
      )
    }

    function Android() {
      return (
        <>
          <span className="text-sm text-2">Plug the USB cable into the desktop and make sure its USB listener is enabled.</span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onUsbConnectClick}>
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
        </>
      )
    }

    return (
      isDesktop ? (
        <Desktop />
      ) : (
        <Android />
      )
    )
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <PageHeader title="Ping" subtitle="Template extension" />

      <div className="flex gap-1 rounded-md p-1 w-fit bg-window">
        {(["webrtc", "usb", "ble"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded-md text-sm transition-colors button-toggle-ghost ${mode === m
              ? "active"
              : ""
              }`}
          >
            {m === "webrtc" ? "WebRTC" : m === "usb" ? "USB" : "BLE"}
          </button>
        ))}
      </div>

      {mode === "webrtc" ? (
        <Webrtc />
      ) : mode === "usb" ? (
        <Usb />
      ) : (
        <p className="text-xs text-3">
          BLE transport is not implemented yet
        </p>
      )}

      <pre className="rounded-md p-3 text-xs h-64 overflow-y-auto whitespace-pre-wrap bg-window select-text">
        {state.logs.join("\n")}
      </pre>
    </div>
  );
}