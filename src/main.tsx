import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startNetworking } from "./core/net";
import { activateExtensions } from "./core/registry";
import "./index.css";

startNetworking();
activateExtensions();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
