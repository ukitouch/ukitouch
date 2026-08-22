import { useState, useSyncExternalStore } from "react";
import { openPingChannel, pingStore, sendPing } from "./api";

export default function PingView() {
  const state = useSyncExternalStore(pingStore.subscribe, pingStore.getState);
  const [target, setTarget] = useState("");

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold mb-1">Ping</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Template extension
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="target device id"
          className="flex-1 min-w-0 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 font-mono text-sm"
        />
        <button
          onClick={() => void openPingChannel(target.trim())}
          className="bg-gray-700 text-gray-100 rounded-md px-3 py-1.5 hover:bg-gray-600 transition-colors"
        >
          Connect
        </button>
        <button
          onClick={sendPing}
          disabled={!state.openTarget}
          className="bg-gray-700 text-gray-100 rounded-md px-3 py-1.5 hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          Ping
        </button>
      </div>

      <pre className="bg-gray-100 dark:bg-gray-800 rounded-md p-3 text-xs h-64 overflow-y-auto whitespace-pre-wrap">
        {state.logs.join("\n")}
      </pre>
    </div>
  );
}
