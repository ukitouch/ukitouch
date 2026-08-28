import { hostCapabilities } from "./host";
import { onChannel, openChannel} from "./p2p";
import type { OpenSpec } from "./transport";
import type { ExtensionContext } from "./types";

export function makeContext(extId: string): ExtensionContext {
  return {
    ...hostCapabilities,
    openChannel: (request: OpenSpec) => {
      if (request.transport !== "webrtc") {
        return Promise.reject(new Error(`transport not implemented: ${request.transport}`));
      }
      return openChannel(request.target, extId);
    },
    onChannel: (handler) => onChannel(handler),
  };
}
