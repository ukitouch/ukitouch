import { serverConfig } from "./config";
import { hostCapabilities } from "./host";
import { deviceUuid, genTempId } from "./identity";
import { createSignaling, onChannel, openChannel, signaling } from "./p2p";
import { createStore } from "./store";
import type { OpenSpec } from "./transport";
import type { ExtensionContext } from "./types";

export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    deviceId: deviceUuid,
    openChannel: (request: OpenSpec) => {
      if (request.transport !== "webrtc") {
        return Promise.reject(new Error(`transport not implemented: ${request.transport}`));
      }
      return openChannel(request.target, extId);
    },
    onChannel: (handler) => onChannel(handler),
  };
}

// A second WS registered with a short, user-visible temp id.

export const tempIdStore = createStore<{ enabled: boolean; id: string | null }>({
  enabled: false,
  id: null,
});

let signalingTemp: ReturnType<typeof createSignaling> | null = null;

export function isTempIdOn(): boolean {
  return tempIdStore.get().enabled;
}

export async function enableTempId(): Promise<string> {
  if (!serverConfig.signaling) throw new Error("no signaling configured");
  if (signalingTemp) {
    await signalingTemp.disconnect();
    signalingTemp = null;
  }

  // Pick a temp id the server doesn't already hold; rotate until unique.
  let tempId = genTempId();
  for (let i = 0; i < 20; i++) {
    if (!(await signaling.query(tempId))) break;
    tempId = genTempId();
  }

  signalingTemp = createSignaling("temp");
  signalingTemp.onForward((f) => {
    if (f.value.resolve === true) {
      signalingTemp?.send(f.from, { uuid: deviceUuid }).catch(console.error);
    }
  });
  await signalingTemp.connect(serverConfig.signaling, tempId);
  tempIdStore.set({ enabled: true, id: tempId });
  return tempId;
}

export async function disableTempId(): Promise<void> {
  await signalingTemp?.disconnect();
  signalingTemp = null;
  tempIdStore.set({ enabled: false, id: null });
}
