import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./theme.css";

// HashRouter so the app works from any static host (GitHub Pages) with no
// server-side rewrites; also fine when served by the bundled Express server.
async function boot() {
  if (import.meta.env.VITE_LOCAL_MODE === "1") {
    // Browser-only mode: SQLite (wasm) + agents run on-device.
    const { initLocalBackend } = await import("./local/boot");
    await initLocalBackend();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  );
}

boot();
