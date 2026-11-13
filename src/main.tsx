import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/Confirm";
import { startSignaling } from "./core/transport/p2p";
import { deviceStore } from "./core/devices";
import { activateExtensions } from "./extensions/registry";
import { loadInstalledExtensions } from "./extensions/loader";
import { loadBundledExtensions } from "./extensions";
import "./index.css";
import "./theme.css";

// Load extensions.
loadBundledExtensions()
  .then(loadInstalledExtensions)
  .then(activateExtensions)
  .catch((e) => console.error("[ext] load failed", e));

startSignaling().catch((e) => console.error("[sig] start failed", e));
void deviceStore
  .init()
  .catch((err) => console.error("[devices] init failed:", err));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfirmProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ConfirmProvider>
  </React.StrictMode>
);
