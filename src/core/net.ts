import { serverConfig } from "./config";
import { hostCapabilities } from "./host";
import { deviceId } from "./identity";
import { PeerManager } from "./peer";
import { Signaling } from "./signaling";
import type { ExtensionContext } from "./types";

/** Networking singletons */
export const signaling = new Signaling();
export const peers = new PeerManager(
  signaling,
  () => ({ urls: serverConfig.iceServers }),
  deviceId
);

/** Build the context handed to one extension's activate(). */
export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    deviceId,
    openChannel: (targetId, options) =>
      peers.openChannel(targetId, extId, options),
    onChannel: (handler) => peers.onChannel(extId, handler),
  };
}

/** Bring the signaling connection up. Called once at app startup. */
export function startNetworking(): void {
  if (!serverConfig.signaling) {
    console.warn(
      "[net] no signaling server configured (VITE_SIGNALING); p2p disabled"
    );
    return;
  }
  signaling.onNotice((msg) => console.warn(`[signaling] ${msg}`));
  signaling.connect(serverConfig.signaling, deviceId);
}
