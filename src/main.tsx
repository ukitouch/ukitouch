import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/Confirm";
import { startSignaling } from "./core/p2p";
import { deviceStore } from "./core/devices";
import { activateExtensions } from "./core/registry";
import { loadInstalledExtensions } from "./core/loader";
import { installBridge } from "./api";
import "./index.css";

// Load extensions.
installBridge();  // runtime surface
loadInstalledExtensions().catch((e) => console.error("[ext] load failed", e));
activateExtensions();

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
