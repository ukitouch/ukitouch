import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startSignaling } from "./core/p2p";
import { activateExtensions } from "./core/registry";
import "./index.css";

startSignaling().catch((e) => console.error("[sig] start failed", e));
activateExtensions();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
