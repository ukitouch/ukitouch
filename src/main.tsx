import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./toast";
import { startSignaling } from "./core/p2p";
import { deviceStore } from "./core/devices";
import { activateExtensions, registerExtension } from "./core/registry";
import { loadInstalledExtensions } from "./core/loader";
import "./index.css";

// Bridge for externally-loaded extensions.
window.__extRegistry = {
  register: (def) => {
    registerExtension({
      id: def.id,
      title: def.id,
      icon: <></>,
      component: def.view,
      activate: def.activate,
    });
  },
};

startSignaling().catch((e) => console.error("[sig] start failed", e));
loadInstalledExtensions().catch((e) => console.error("[ext] load failed", e));
activateExtensions();
void deviceStore
  .init()
  .catch((err) => console.error("[devices] init failed:", err));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
