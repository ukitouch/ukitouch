import { hostCapabilities } from "./host";
import { deviceStore } from "./devices";
import { getHostInfo } from "./hostinfo";
import { onChannel, openChannel } from "./p2p";
import { onUsbChannel, openUsbChannel } from "./usb";
import { deviceUuid } from "./identity";
import type { CoreProtocol, HelloInfo } from "./db";
import type { OpenSpec } from "./transport";
import type { Channel, ExtensionContext } from "./types";

/** In-band hello: both ends send one over the opened channel. */
interface HelloMsg {
  uuid: string;
  hello: HelloInfo;
}

function decodeText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data))
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  return null;
}

function parseHello(data: unknown): HelloMsg | null {
  const text = decodeText(data);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { uuid, hello } = parsed as { uuid?: unknown; hello?: unknown };
  if (typeof uuid !== "string" || typeof hello !== "object" || hello === null)
    return null;
  return { uuid, hello: hello as HelloInfo };
}

/**
 * Wrap an opened channel so both ends exchange an in-band hello.
 */
function attachHello(
  raw: Channel,
  direction: "in" | "out",
  extId: string,
  protocol: CoreProtocol
): Channel {
  let extOnmessage: Channel["onmessage"] = null;
  let first = true;

  // Convention: the first message on a freshly-opened channel is the peer's
  // hello (both ends send it on open), consumed here and kept out of the
  // extension's data channel.
  raw.onmessage = (ev) => {
    if (first) {
      first = false;
      const hello = parseHello(ev.data);
      if (hello) {
        void deviceStore
          .recordConnection({
            uuid: hello.uuid,
            direction,
            protocol,
            extension: extId,
            hello: hello.hello,
          })
          .catch((err) => console.error("[devices] record failed:", err));
      }
      return;
    }
    extOnmessage?.(ev);
  };

  // Send our hello right after the channel opens.
  Promise.resolve(getHostInfo())
    .then((hello) => raw.send(JSON.stringify({ uuid: deviceUuid, hello })))
    .catch((err) => console.error("[net] hello send failed:", err));

  // Proxy the channel so the extension's onmessage assignment targets
  // extOnmessage (routed past the hello handshake) while everything else
  // passes straight through to the raw channel.
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

export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    openChannel: (request: OpenSpec) => {
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
      onChannel((ch) => handler(attachHello(ch, "in", extId, "p2p")));
      onUsbChannel((ch) => handler(attachHello(ch, "in", extId, "usb")));
    },
    getKnownDevices: () => deviceStore.getSnapshot().devices,
    onDeviceSeen: (handler) => {
      // First callback waits for the store to finish loading
      void deviceStore.init().then(() => {
        handler(deviceStore.getSnapshot().devices);
      });
      return deviceStore.subscribe(() =>
        handler(deviceStore.getSnapshot().devices)
      );
    },
  };
}
