import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./theme.css";

// HashRouter so the app works from any static host (GitHub Pages) with no
// server-side rewrites; also fine when served by the bundled Express server.
function renderBootError(err: unknown) {
  const message =
    err instanceof Error ? err.message : "Something went wrong while starting the app.";
  const root = document.getElementById("root")!;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "max-width:420px;margin:18vh auto 0;padding:24px;font-family:system-ui,sans-serif;text-align:center;";
  const h = document.createElement("h2");
  h.textContent = "Darfum couldn't start";
  const p = document.createElement("p");
  p.textContent = message;
  p.style.cssText = "color:#52514e;line-height:1.5;";
  const btn = document.createElement("button");
  btn.textContent = "Try again";
  btn.style.cssText =
    "font:inherit;font-weight:600;padding:9px 18px;border-radius:8px;border:1px solid #c3c2b7;background:#2a78d6;color:#fff;cursor:pointer;";
  btn.onclick = () => location.reload();
  box.append(h, p, btn);
  root.append(box);
}

async function boot() {
  try {
    if (import.meta.env.VITE_LOCAL_MODE === "1") {
      // Browser-only mode: SQLite (wasm) + agents run on-device.
      const { initLocalBackend } = await import("./local/boot");
      await initLocalBackend();
    }
  } catch (err) {
    console.error("Boot failed:", err);
    renderBootError(err);
    return;
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
