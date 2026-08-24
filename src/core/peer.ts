import type { Signaling, ForwardedMessage } from "./signaling";
import type { Transport, WebRtcOpenSpec } from "./transport";
import type { Channel } from "./types";

interface PeerState {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

/**
 * The WebRTC Transport backend.
 */
export class PeerManager implements Transport {
  readonly kind = "webrtc" as const;

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
  onIncoming(extId: string, handler: (channel: Channel) => void): void {
    this.channelHandlers.set(extId, handler);
  }

  /**
   * Open a channel to a target device.
   */
  open(request: WebRtcOpenSpec, extId: string): Promise<Channel> {
    const peer = this.getPeer(request.target);
    const init: RTCDataChannelInit | undefined =
      request.reliable === false
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
        resolve(channel as unknown as Channel);
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
      // The channel label IS the extension id.
      const handler = this.channelHandlers.get(channel.label);
      if (handler) handler(channel as unknown as Channel);
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
