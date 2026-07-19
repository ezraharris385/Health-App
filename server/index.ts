import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { settingsRouter } from "./routes/settings";
import { agentsRouter } from "./routes/agents";
import { workoutRouter } from "./routes/workout";
import { nutritionRouter } from "./routes/nutrition";
import { sleepRouter } from "./routes/sleep";
import { vitaminsRouter } from "./routes/vitamins";
import { mobilityRouter } from "./routes/mobility";
import { dashboardRouter } from "./routes/dashboard";
import { hasApiKey } from "./anthropic";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

app.use("/api/settings", settingsRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/workout", workoutRouter);
app.use("/api/nutrition", nutritionRouter);
app.use("/api/sleep", sleepRouter);
app.use("/api/vitamins", vitaminsRouter);
app.use("/api/mobility", mobilityRouter);
app.use("/api/dashboard", dashboardRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiEnabled: hasApiKey() });
});

// Serve the built client in production
const clientDist = path.join(here, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`Health app server on http://localhost:${port}`);
  // Print LAN addresses so the app is easy to open from a phone on the same network.
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  on your phone: http://${net.address}:${port}`);
      }
    }
  }
  if (!hasApiKey()) {
    console.log("Note: ANTHROPIC_API_KEY not set — AI assistants disabled until configured.");
  }
});
