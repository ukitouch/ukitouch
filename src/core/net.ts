import { hostCapabilities } from "./host";
import { onChannel, openChannel } from "./p2p";
import { onUsbChannel, openUsbChannel } from "./usb";
import type { OpenSpec } from "./transport";
import type { ExtensionContext } from "./types";

/** Open an outgoing channel over the given transport. */
function open(request: OpenSpec, extId: string): Promise<import("./types").Channel> {
  if (request.transport === "webrtc") {
    return openChannel(request.target, extId);
  }
  if (request.transport === "usb") {
    return openUsbChannel(request.serial ?? "", extId);
  }
  return Promise.reject(new Error(`transport not implemented: ${request.transport}`));
}

/** Route incoming channels to the extension on every transport. */
function routeIncoming(handler: (ch: import("./types").Channel) => void): void {
  onChannel(handler);
  onUsbChannel(handler);
}

export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    openChannel: (request: OpenSpec) => open(request, extId),
    onChannel: (handler) => routeIncoming(handler),
  };
}
