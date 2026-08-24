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
import type { ForwardedMessage } from "./signaling";
import { dispatchOnIncoming, dispatchOpen, type OpenSpec, type Transport, type TransportKind, type WebRtcOpenSpec } from "./transport";
import type { ExtensionContext } from "./types";

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

const webrtcTransport: Transport = {
  kind: "webrtc",
  open: (request: OpenSpec, extId) => {
    const w = request as WebRtcOpenSpec;
    // 9-digit discoverable id -> uuid, then hand off to the webrtc backend.
    return resolveTarget(w.target).then((uuid) =>
      peers.open({ ...w, target: uuid }, extId)
    );
  },
  onIncoming: (extId, handler) => peers.onIncoming(extId, handler),
};

export const transports: ReadonlyMap<TransportKind, Transport> = new Map([
  ["webrtc", webrtcTransport],
]);

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
    openChannel: (request) => dispatchOpen(transports, request, extId),
    onChannel: (handler) => dispatchOnIncoming(transports, extId, handler),
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
