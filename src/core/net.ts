import { serverConfig } from "./config";
import { hostCapabilities } from "./host";
import {
  deviceUuid,
  getTempId,
  isTempIdEnabled,
  rotateTempId,
} from "./identity";
import { PeerManager } from "./peer";
import { Signaling } from "./signaling";
import { deviceStore } from "./devices";
import { getHostInfo } from "./hostinfo";
import type { CoreProtocol, HelloInfo } from "./db";
import type { ForwardedMessage } from "./signaling";
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
function handleHello(from: string, payload: ForwardedMessage): void {
  if (typeof payload.hello !== "object" || payload.hello === null) return;
  const hello = payload.hello as HelloInfo;
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

/**
 * Primary signaling connection, registered with this device's uuid.
 * All P2P (WebRTC) signaling flows through here. The uuid is the device's
 * permanent identity and is never shown to the user.
 */
export const signaling = new Signaling();
export const peers = new PeerManager(
  signaling,
  () => ({ urls: serverConfig.iceServers }),
  deviceUuid
);

/** Registered with a short, user-visible temp id. */
let signalingTemp: Signaling | null = null;

/** Dialer-side pending tempId -> uuid resolutions. */
const pendingResolves = new Map<string, (uuid: string) => void>();

function handleForward(from: string, payload: ForwardedMessage): void {
  // A resolve reply carries the target device's uuid.
  if (typeof payload.uuid === "string") {
    const resolve = pendingResolves.get(from);
    if (resolve) {
      pendingResolves.delete(from);
      resolve(payload.uuid);
    }
  }
  // Hello handshake: peer reports its system info.
  if (payload.hello !== undefined) {
    handleHello(from, payload);
  }
}

/** 9-digit discoverable id, as opposed to a uuid. */
function isTempId(s: string): boolean {
  return /^\d{9}$/.test(s);
}

/**
 * Resolve a target the extension wants to reach. If it's a 9-digit temp id,
 * ask the server to translate it into the device's uuid first; uuids pass
 * through unchanged. All P2P connections are uuid-based.
 */
async function resolveTarget(targetId: string): Promise<string> {
  if (!isTempId(targetId)) return targetId;
  return resolveUuid(targetId);
}

function resolveUuid(tempId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolves.delete(tempId);
      reject(new Error(`could not resolve id \`${tempId}\``));
    }, 5000);
    pendingResolves.set(tempId, (uuid) => {
      clearTimeout(timer);
      resolve(uuid);
    });
    signaling.send(tempId, { resolve: true });
  });
}

export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    deviceId: deviceUuid,
    openChannel: (targetId, options) =>
      resolveTarget(targetId).then(async (uuid) => {
        // Best-effort hello exchange, non-blocking.
        void sendHello(uuid).catch((err) =>
          console.error("[net] hello failed:", err)
        );
        const channel = await peers.openChannel(uuid, extId, options);
        // Successful dial → register the device and log the connection.
        void deviceStore
          .recordConnection({
            uuid,
            direction: "out",
            protocol: CORE_PROTOCOL,
            plugin: extId,
            hello: helloCache.get(uuid),
          })
          .catch((err) => console.error("[devices] record outbound failed:", err));
        return channel;
      }),
    onChannel: (handler) =>
      peers.onChannel(extId, (channel) => {
        // Inbound channel → register the device and log the connection.
        void deviceStore
          .recordConnection({
            uuid: channel.peerId,
            direction: "in",
            protocol: CORE_PROTOCOL,
            plugin: extId,
            hello: helloCache.get(channel.peerId),
          })
          .catch((err) => console.error("[devices] record inbound failed:", err));
        handler(channel);
      }),
  };
}

/** Bring the uuid signaling connection up. Called once at app startup. */
export function startNetworking(): void {
  if (!serverConfig.signaling) {
    console.warn(
      "[net] no signaling server configured (VITE_SIGNALING); p2p disabled"
    );
    return;
  }
  signaling.onNotice((msg) => console.warn(`[signaling] ${msg}`));
  signaling.onForward(handleForward);
  signaling.connect(serverConfig.signaling, deviceUuid);
  if (isTempIdEnabled()) {
    void enableTempId();
  }
}

// Optional discovery: a second WS registered with a short, user-visible temp id.
// A stranger dials the temp id; this device replies with its uuid, after which
// the P2P connection proceeds on the uuid channel (transparent to the user).

export function isTempIdOn(): boolean {
  return signalingTemp !== null;
}

export async function enableTempId(): Promise<void> {
  if (!serverConfig.signaling) return;
  if (signalingTemp) {
    signalingTemp.disconnect();
    signalingTemp = null;
  }
  await signaling.waitReady();

  // Pick a temp id the server doesn't already hold; rotate until unique.
  let tempId = getTempId();
  for (let i = 0; i < 20; i++) {
    if (!(await signaling.query(tempId))) break;
    tempId = rotateTempId();
  }

  signalingTemp = new Signaling();
  signalingTemp.onForward((from, payload) => {
    if (payload.resolve === true) {
      signalingTemp?.send(from, { uuid: deviceUuid });
    }
  });
  signalingTemp.connect(serverConfig.signaling, tempId);
}

export function disableTempId(): void {
  signalingTemp?.disconnect();
  signalingTemp = null;
}
