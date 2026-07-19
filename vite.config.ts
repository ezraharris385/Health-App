import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(here, "client"),
  // GitHub Pages serves the app under /<repo-name>/ — set via env in build:pages.
  base: process.env.PAGES_BASE || "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.join(here, "shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    outDir: path.join(here, "client", "dist"),
    emptyOutDir: true,
  },
});
