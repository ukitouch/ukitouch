import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startSignaling } from "./core/p2p";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
