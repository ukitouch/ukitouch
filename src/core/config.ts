export interface ServerConfig {
  /** Full WebSocket URL of the signaling server */
  signaling: string;
  /** ICE server URLs, e.g. ["stun:host:3478"]. */
  iceServers: string[];
}

/**
 * Server config. Servers are self-hosted by the user.
 * Local dev defaults come from .env.local
 */
export const serverConfig: ServerConfig = {
  signaling: import.meta.env.VITE_SIGNALING ?? "",
  iceServers: (import.meta.env.VITE_ICE_SERVERS ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean),
};
