import { Router } from "express";
import { getSettings, saveSettings } from "../settingsStore";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getSettings());
});

settingsRouter.put("/", (req, res) => {
  res.json(saveSettings(req.body ?? {}));
});
