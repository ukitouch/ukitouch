import { useEffect, useSyncExternalStore, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { bindHost } from "./core/host";
import { listExtensions, subscribeExtensions } from "./core/registry";
import type { Layout } from "./core/types";
import "./extensions";
import Home from "./pages/Home";
import SettingPage from "./pages/Settings";
import { ExtensionsManager } from "./pages/ExtensionsManager";

const BUILTIN_PAGES: Record<string, ComponentType> = {
  manager: ExtensionsManager,
  settings: SettingPage,
};

function App() {
  const [activeId, setActiveId] = useState<string | null>(null); // null = home
  const [layout, setLayout] = useState<Layout>("withSidebar");

  useEffect(() => bindHost({ setLayout }), [setLayout]);

  const extensions = useSyncExternalStore(subscribeExtensions, listExtensions);
  const active = extensions.find((ext) => ext.id === activeId);
  const ActiveComponent = active?.component;

  return (
    <>
      {layout === "withSidebar" && (
        <aside className="border-r-2 border-gray-800 w-16 flex flex-col items-center">
          <div className="flex flex-1 flex-col overflow-auto scrollbar-hide pt-4 pb-2 gap-2">
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
            {
              extensions.map((ext) => (
                <SidebarButton
                  key={ext.id}
                  title={ext.title}
                  active={active?.id === ext.id}
                  onClick={() => setActiveId(ext.id)}
                  icon={ext.icon}
                />
              ))
            }
            <SidebarButton
              title="Extensions"
              active={activeId === "manager"}
              onClick={() => setActiveId("manager")}
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
          </div>
          <div className="p-2">
            <hr className="border-gray-800 dark:border-gray-600 mb-2 w-full"></hr>

            <SidebarButton
              title="Settings"
              active={activeId === "settings"}
              onClick={() => setActiveId("settings")}
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
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12,2 L12.68,5.53 L19.07,4.93 L18.47,9.32 L22,12 L18.47,14.68 L19.07,19.07 L14.68,18.47 L12,22 L9.32,18.47 L4.93,19.07 L5.53,14.68 L2,12 L5.53,9.32 L4.93,4.93 L9.32,5.53Z" />
                </svg>
              }
            />
          </div>
        </aside>
      )}
      <MainPageContent />
    </>
  );
  function MainPageContent() {
    const Page =
      (activeId ? BUILTIN_PAGES[activeId] : undefined) ?? ActiveComponent ?? Home;
    return (
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Page />
      </main>
    );
  }
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


export default App;
