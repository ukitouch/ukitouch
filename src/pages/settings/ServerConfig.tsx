import { useState } from "react";
import { EditableField } from "../../components/EditableField";
import { reconnectSignaling, SERVER_CONFIG_KEY, type ServerConfig } from "../../core/transport/p2p";
import { useConfirm } from "../../components/Confirm";
import { showToast } from "../../components/Toast";

/** Read server config from localStorage. */
export function readServerConfig(): ServerConfig {
  try {
    const raw = localStorage.getItem(SERVER_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.signalingUrl === "string" && Array.isArray(parsed.iceServers)) {
        return parsed as ServerConfig;
      }
    }
  } catch {
    // ignore parse errors, fall through to defaults
  }
  return {
    signalingUrl: "",
    iceServers: []
  }
}

/** Persist server config to localStorage. */
function saveServerConfig(config: ServerConfig) {
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(normalizeServerConfig(config)));
}

/** Trim and drop empty entries. */
function normalizeServerConfig(config: ServerConfig): ServerConfig {
  return {
    signalingUrl: config.signalingUrl.trim(),
    iceServers: config.iceServers.map((s) => s.trim()).filter(Boolean),
  };
}

function sameServerConfig(a: ServerConfig, b: ServerConfig) {
  return (
    a.signalingUrl === b.signalingUrl &&
    a.iceServers.join(",") === b.iceServers.join(",")
  );
}

export default function ServerConfig() {
  const [serverConfig, setServerConfig] = useState<ServerConfig>(readServerConfig);
  const confirm = useConfirm();

  /** Save a new config, then offer to reconnect onto it right away. */
  const applyServerConfig = async (next: ServerConfig) => {
    const normalized = normalizeServerConfig(next);
    const changed = !sameServerConfig(normalized, normalizeServerConfig(serverConfig));

    setServerConfig(normalized);
    saveServerConfig(normalized);
    if (!changed) return;

    const ok = await confirm({
      title: "Reconnect now?",
      message:
        "A new server configuration needs a reconnect, but will close all existing p2p connections. You can also apply it by restarting the app.",
      confirmText: "Reconnect",
      cancelText: "Later",
    });
    if (ok) {
      try {
        await reconnectSignaling(normalized);
      } catch (e) {
        showToast(`reconnect failed: ${e}`, "error");
        return;
      }
    }
    showToast(
      ok
        ? "server config saved, reconnected"
        : "server config saved, restart to apply"
    );
  };

  const updateSignalingUrl = (value: string) =>
    applyServerConfig({ ...serverConfig, signalingUrl: value });

  const updateIceServers = (value: string) =>
    applyServerConfig({
      ...serverConfig,
      iceServers: value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });

  return (
    <div className="py-3">
      <div className="text-sm font-medium mb-2 text-2">Server Configuration</div>

      <div className="px-4">
        <EditableField
          label="Signaling URL"
          value={serverConfig.signalingUrl}
          placeholder="e.g. wss://your-signaling-server.example.com"
          onSave={updateSignalingUrl}
        />

        <EditableField
          label="ICE Servers"
          value={serverConfig.iceServers.join(", ")}
          placeholder="e.g. stun:host:3478"
          onSave={updateIceServers}
        />
      </div>
    </div>
  )
}