import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { disableTempId, enableTempId } from "./core/net";
import {
  getTempId,
  isTempIdEnabled,
  rotateTempId,
  setTempIdEnabled,
} from "./core/identity";
import { bindHost } from "./core/host";
import { listExtensions } from "./core/registry";
import type { Layout } from "./core/types";
import "./extensions";

function App() {
  const [activeId, setActiveId] = useState<string | null>(null); // null = home
  const [layout, setLayout] = useState<Layout>("withSidebar");

  useEffect(() => bindHost({ setLayout }), [setLayout]);

  const extensions = useMemo(listExtensions, []);
  const active = extensions.find((ext) => ext.id === activeId);
  const ActiveComponent = active?.component;

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
        </aside>
      )}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {ActiveComponent ? <ActiveComponent /> : <Home />}
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
                  await navigator.clipboard.writeText(tempId);
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
