import type { Signaling, ForwardedMessage } from "./signaling";
import type { Channel } from "./types";

/** Available channel transports. */
export type TransportKind = "webrtc" | "usb" | "ble";

/** Option: reliable & ordered (default) or fire-and-forget. */
export interface ChannelOptions {
  reliable?: boolean;
  /**
   * Transports the extension is willing to use, in preference order.
   */
  transports?: TransportKind[];
}

/**
 * Wrap an RTCDataChannel as the Channel contract, attaching the remote peer's
 * uuid (Channel.peerId). A wrapper object (rather than
 * an expando property on the WebIDL object) guarantees peerId on every engine.
 */
function asChannel(rtc: RTCDataChannel, peerId: string): Channel {
  const send = rtc.send.bind(rtc) as (
    data: string | ArrayBuffer | ArrayBufferView | Blob
  ) => void;
  return {
    label: rtc.label,
    peerId,
    get readyState() {
      return rtc.readyState;
    },
    get bufferedAmount() {
      return rtc.bufferedAmount;
    },
    send,
    close: () => rtc.close(),
    get onmessage() {
      return rtc.onmessage;
    },
    set onmessage(v) {
      rtc.onmessage = v;
    },
    get onclose() {
      return rtc.onclose;
    },
    set onclose(v) {
      rtc.onclose = v;
    },
    get onopen() {
      return rtc.onopen;
    },
    set onopen(v) {
      rtc.onopen = v;
    },
    get onerror() {
      return rtc.onerror as ((ev: Event) => void) | null;
    },
    set onerror(v) {
      rtc.onerror = v as ((ev: RTCErrorEvent) => void) | null;
    },
  };
}

interface PeerState {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

/**
 * Owns RTCPeerConnections (one per remote device) and routes DataChannels
 * to extensions by label. Payloads inside channels are never inspected here.
 *
 * Negotiation follows the MDN "perfect negotiation" pattern; politeness is
 * derived deterministically from device ids, so no extra signaling is needed.
 */
export class PeerManager {
  private peers = new Map<string, PeerState>();
  private channelHandlers = new Map<string, (channel: Channel) => void>();

  constructor(
    private signaling: Signaling,
    private ice: () => RTCIceServer,
    private localId: string
  ) {
    signaling.onForward((from, payload) => {
      this.handleSignal(from, payload).catch((err) => {
        console.error(`[peer] signal handling failed for ${from}:`, err);
      });
    });
  }

  /** Route future incoming channels labelled `extId` to `handler`. */
  onChannel(extId: string, handler: (channel: Channel) => void): void {
    this.channelHandlers.set(extId, handler);
  }

  /**
   * Open a channel to a target device. Creating the first channel on a fresh
   * peer connection triggers negotiation automatically — lazy by design.
   */
  openChannel(
    targetId: string,
    extId: string,
    options?: ChannelOptions
  ): Promise<Channel> {
    const peer = this.getPeer(targetId);
    const init: RTCDataChannelInit | undefined =
      options?.reliable === false
        ? { ordered: false, maxRetransmits: 0 }
        : undefined;
    const channel = peer.pc.createDataChannel(extId, init);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("channel open timed out")),
        10_000
      );
      channel.onopen = () => {
        clearTimeout(timer);
        resolve(asChannel(channel, targetId));
      };
      channel.onerror = () => {
        clearTimeout(timer);
        reject(new Error("channel failed to open"));
      };
    });
  }

  private getPeer(targetId: string): PeerState {
    const existing = this.peers.get(targetId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: [this.ice()] });
    const state: PeerState = {
      pc,
      polite: this.localId < targetId,
      makingOffer: false,
      ignoreOffer: false,
    };
    this.peers.set(targetId, state);

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling.send(targetId, {
          description: pc.localDescription?.toJSON(),
        });
      } finally {
        state.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signaling.send(targetId, { candidate: candidate.toJSON() });
      }
    };

    pc.ondatachannel = ({ channel }) => {
      // The channel label IS the extension id; targetId is the remote peer's uuid.
      const handler = this.channelHandlers.get(channel.label);
      if (handler) handler(asChannel(channel, targetId));
      else channel.close();
    };

    pc.oniceconnectionstatechange = () => {
      console.warn(`[peer] ${targetId} ice: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        console.warn(`[peer] ${targetId}: ${pc.connectionState}`);
        this.peers.delete(targetId);
      }
    };

    return state;
  }

  private async handleSignal(
    from: string,
    payload: ForwardedMessage
  ): Promise<void> {
    const description = payload.description as
      | RTCSessionDescriptionInit
      | undefined;
    const candidate = payload.candidate as RTCIceCandidateInit | undefined;
    if (!description && !candidate) return;

    const state = this.getPeer(from);
    const { pc } = state;

    if (description) {
      const offerCollision =
        description.type === "offer" &&
        (state.makingOffer || pc.signalingState !== "stable");
      state.ignoreOffer = !state.polite && offerCollision;
      if (state.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        this.signaling.send(from, {
          description: pc.localDescription?.toJSON(),
        });
      }
    } else if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (!state.ignoreOffer) throw err;
      }
    }
  }
}
