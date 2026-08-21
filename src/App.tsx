import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-2">YATouch</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Devices and settings will live here. Pick an extension from the
        sidebar.
      </p>
    </div>
  );
}

export default App;
