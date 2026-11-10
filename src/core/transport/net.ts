import { hostCapabilities } from "../utils/ui";
import { deviceStore } from "../devices";
import { getHostInfo } from "../hostinfo";
import { onChannel, openChannel, cancelConnection } from "./p2p";
import { onUsbChannel, openUsbChannel } from "./usb";
import { deviceUuid } from "../identity";
import type { CoreProtocol } from "../db";
import type { Channel, OpenSpec } from ".";
import type { Disposable, HostInfo, NetContext as NetContext } from "../types";
import { toDisposable } from "../types";

/** A message to exchange two peers' host info. */
interface HelloMsg {
  uuid: string;
  hostInfo: HostInfo;
}

function parseHello(data: unknown): HelloMsg | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { uuid, hostInfo } = parsed as { uuid?: unknown; hostInfo?: unknown };
  if (typeof uuid !== "string" || typeof hostInfo !== "object" || hostInfo === null)
    return null;
  return { uuid, hostInfo: hostInfo as HostInfo };
}

/**
 * Wrap an opened channel to exchange host info by sending {@link HelloMsg}.
 */
function attachHello(
  raw: Channel,
  direction: "in" | "out",
  extId: string,
  protocol: CoreProtocol
): Channel {
  let extOnmessage: Channel["onmessage"] = null;

  // Consume the peer's hello by shape.
  raw.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const hello = parseHello(ev.data);
      if (hello) {
        void deviceStore
          .recordConnection({
            uuid: hello.uuid,
            direction,
            protocol,
            extension: extId,
            hostInfo: hello.hostInfo,
          })
          .catch((err) => console.error("[devices] record failed:", err));
        return;
      }
    }
    extOnmessage?.(ev);
  };

  // Send our hello right after the channel opens.
  Promise.resolve(getHostInfo())
    .then((hostInfo) => raw.send(JSON.stringify({ uuid: deviceUuid, hostInfo })))
    .catch((err) => console.error("[net] hello send failed:", err));

  // Proxy the channel to intercept the peer's hello.
  // This makes sure extension will not receive the hello message.
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === "onmessage") return extOnmessage;
      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      if (prop === "onmessage") {
        extOnmessage = value;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  });
}

/**
 * Create a {@link NetContext} for an extension.
 */
export function makeContext(extId: string): NetContext {
  const subscriptions: Disposable[] = [];
  return {
    ...hostCapabilities,
    subscriptions,
    openChannel: async (request: OpenSpec) => {
      const { transport } = request;
      if (transport === "usb") {
        return openUsbChannel(request.serial ?? "", extId).then((ch) =>
          attachHello(ch, "out", extId, "usb")
        );
      }
      if (transport !== "webrtc") {
        return Promise.reject(
          new Error(`transport not implemented: ${transport}`)
        );
      }
      const { target } = request;
      return openChannel(target, extId).then((ch) =>
        attachHello(ch, "out", extId, "p2p")
      );
    },
    onChannel: (handler) => {
      const unsubs = [
        onChannel(extId, (ch) => handler(attachHello(ch, "in", extId, "p2p"))),
        onUsbChannel(extId, (ch) => handler(attachHello(ch, "in", extId, "usb"))),
      ];
      return toDisposable(() => {
        for (const unsub of unsubs) unsub();
      });
    },
    bindPipe: (channel, addr) => {
      if (!channel.bindPipe) {
        return Promise.reject(new Error("this transport has no pipes"));
      }
      return channel.bindPipe(addr);
    },
    cancelOpenChannel: () => cancelConnection(),
    getKnownDevices: () => deviceStore.getSnapshot().devices,
    onDeviceSeen: (handler) => {
      // First callback waits for the store to finish loading
      void deviceStore.init().then(() => {
        handler(deviceStore.getSnapshot().devices);
      });
      const unsub = deviceStore.subscribe(() =>
        handler(deviceStore.getSnapshot().devices)
      );
      return toDisposable(unsub);
    },
  };
}
