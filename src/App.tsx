import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { bindHost } from "./core/host";
import { listExtensions } from "./core/registry";
import type { Layout } from "./core/types";
import "./extensions";
import Home from "./Home";
import SettingPage from "./Setting";

const BUILTIN_PAGES: Record<string, ComponentType> = {
  settings: SettingPage,
};

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
              ))}
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
