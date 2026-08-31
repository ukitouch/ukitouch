import { useEffect, useSyncExternalStore, useState } from "react";
import type { ReactNode } from "react";
import { disableTempId, enableTempId, tempIdStore } from "./core/p2p";
import { bindHost } from "./core/host";
import { listExtensions, subscribeExtensions } from "./core/registry";
import type { Layout } from "./core/types";
import "./extensions";
import { ExtensionsManager } from "./ExtensionsManager";

const MANAGER_ID = "extensions-manager";

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

function App() {
  const [activeId, setActiveId] = useState<string | null>(null); // null = home
  const [layout, setLayout] = useState<Layout>("withSidebar");

  useEffect(() => bindHost({ setLayout }), [setLayout]);

  const extensions = useSyncExternalStore(subscribeExtensions, listExtensions);
  const active = extensions.find((ext) => ext.id === activeId);
  const ActiveComponent = active?.component;
  const showManager = activeId === MANAGER_ID;

  return (
    <>
      {layout === "withSidebar" && (
        <aside className="border-r-2 border-gray-800 w-16 flex flex-col items-center py-4 gap-2">
          <SidebarButton
            title="Home"
            active={activeId === null}
            onClick={() => setActiveId(null)}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            }
          />
          {extensions.map((ext) => (
            <SidebarButton
              key={ext.id}
              title={ext.title}
              active={active?.id === ext.id}
              onClick={() => setActiveId(ext.id)}
              icon={ext.icon}
            />
          ))}
          <SidebarButton
            title="Extensions"
            active={showManager}
            onClick={() => setActiveId(MANAGER_ID)}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917L9.525 1.965A2.404 2.404 0 0 1 11.23 1.26c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
              </svg>
            }
          />
        </aside>
      )}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {showManager ? (
          <ExtensionsManager />
        ) : ActiveComponent ? (
          <ActiveComponent />
        ) : (
          <Home />
        )}
      </main>
    </>
  );
}

function SidebarButton(props: {
  title: string;
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      className={`p-2 rounded-md transition-colors text-gray-800 dark:text-gray-400 hover:bg-gray-600 ${props.active ? "bg-gray-700" : ""
        }`}
    >
      {props.icon}
    </button>
  );
}

function Home() {
  const tmpEnabled = useSyncExternalStore(
    tempIdStore.subscribe,
    () => tempIdStore.get().enabled
  );
  const tempId = useSyncExternalStore(
    tempIdStore.subscribe,
    () => tempIdStore.get().id ?? "---------"
  );
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    try {
      if (tmpEnabled) {
        await disableTempId();
      } else {
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

export default App;
