import { disableTempId, enableTempId } from "./core/net";
import {
  getTempId,
  isTempIdEnabled,
  rotateTempId,
  setTempIdEnabled,
} from "./core/identity";
import { useState } from "react";

async function copyText(text: string): Promise<void> {
  try {
    await import("@tauri-apps/plugin-clipboard-manager").then((m) =>
      m.writeText(text),
    );
    return;
  } catch {
    // fall back to the Web Clipboard API for plain-browser dev
  }
  if (!navigator.clipboard) throw new Error("clipboard unavailable");
  await navigator.clipboard.writeText(text);
}

function Home() {
  const [tmpEnabled, setTempIdEnabledUI] = useState(isTempIdEnabled());
  const [tempId, setTempIdUI] = useState(tmpEnabled ? getTempId() : "---------");
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    try {
      if (tmpEnabled) {
        disableTempId();
        setTempIdEnabled(false);
        setTempIdEnabledUI(false);
        setTempIdUI("---------");
      } else {
        setTempIdEnabled(true);
        setTempIdEnabledUI(true);
        setTempIdUI(rotateTempId());
        await enableTempId();
      }
    } finally {
      window.setTimeout(() => setToggling(false), 500);
    }
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold mb-1">YATouch</h1>
      </div>

      <div>
        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 mb-2">
          <span className="self-center">Temporary ID</span>
          <button
            onClick={() => void toggle()}
            disabled={toggling}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tmpEnabled
              ? "bg-gray-700 hover:bg-gray-600 text-gray-100"
              : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300"
              }`}
          >
            {tmpEnabled ? "Hide" : "Show"}
          </button>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2">
          <code className="flex-1 break-all text-sm text-gray-700 dark:text-gray-300">
            {tempId.replace(/(.{3})(?=.)/g, "$1 ")}
          </code>
          {tmpEnabled ? (
            copied ? (
              <svg
                className="text-gray-400 dark:text-gray-500"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                className="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer"
                onClick={async () => {
                  await copyText(tempId);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
                aria-label="Copy temporary ID"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )
          ) : (
            <></>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {tmpEnabled
            ? "Anyone with this ID can reach you."
            : "Only known contacts can reach you."}
        </span>
      </div>
    </div>
  );
}
export default Home;
