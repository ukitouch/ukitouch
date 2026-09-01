import { hostCapabilities } from "./host";
import { deviceStore } from "./devices";
import { getHostInfo } from "./hostinfo";
import { onChannel, openChannel, signaling } from "./p2p";
import type { CoreProtocol, HelloInfo } from "./db";
import type { OpenSpec } from "./transport";
import type { ExtensionContext } from "./types";

/** Core protocol of this build's transport (WebRTC P2P). USB / BLE transports will supply their own when landed. */
const CORE_PROTOCOL: CoreProtocol = "p2p";

/** Peer system info received via the hello handshake, keyed by peer uuid. */
const helloCache = new Map<string, HelloInfo>();
/** Peers we have already sent our hello to (reply-once guard, prevents echo loops). */
const helloSent = new Set<string>();

/** Send our host info to a peer (best-effort, non-blocking). */
async function sendHello(to: string): Promise<void> {
  if (helloSent.has(to)) return;
  helloSent.add(to);
  signaling.send(to, { hello: await getHostInfo() });
}

/** Handle a peer's hello: cache it, patch an existing device, reply once. */
function handleHello(from: string, value: Record<string, unknown>): void {
  if (typeof value.hello !== "object" || value.hello === null) return;
  const hello = value.hello as HelloInfo;
  helloCache.set(from, hello);
  // Late-arriving hello: patch an already-registered device. If the device is
  // not registered yet, the cached hello is consumed at recordConnection time.
  void deviceStore
    .updateHello(from, hello)
    .catch((err) => console.error("[devices] updateHello failed:", err));
  void sendHello(from).catch((err) =>
    console.error("[net] hello reply failed:", err)
  );
}

// Hello handshake: peer reports its system info on its own signaling connection.
signaling.onForward((f) => {
  if (f.value.hello !== undefined) handleHello(f.from, f.value);
});

export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    openChannel: (request: OpenSpec) => {
      if (request.transport !== "webrtc") {
        return Promise.reject(new Error(`transport not implemented: ${request.transport}`));
      }
      const { target } = request;
      return openChannel(target, extId).then((channel) => {
        void sendHello(channel.peerId).catch((err) =>
          console.error("[net] hello failed:", err)
        );
        // Successful dial → register the device and log the connection.
        void deviceStore
          .recordConnection({
            uuid: channel.peerId,
            direction: "out",
            protocol: CORE_PROTOCOL,
            extension: extId,
            hello: helloCache.get(channel.peerId),
          })
          .catch((err) => console.error("[devices] record outbound failed:", err));
        return channel;
      });
    },
    onChannel: (handler) =>
      onChannel((channel) => {
        // Inbound channel → register the device and log the connection.
        void deviceStore
          .recordConnection({
            uuid: channel.peerId,
            direction: "in",
            protocol: CORE_PROTOCOL,
            extension: extId,
            hello: helloCache.get(channel.peerId),
          })
          .catch((err) => console.error("[devices] record inbound failed:", err));
        handler(channel);
      }),
  };
}
