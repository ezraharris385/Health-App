import { Router } from "express";
import { getSettings, saveSettings } from "../settingsStore";
import {
  SettingsError,
  validateSettingsPatch,
} from "../../shared/data/settingsValidation";

// Re-export so existing import sites keep working after the move to shared/.
export { SettingsError, validateSettingsPatch };

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getSettings());
});

settingsRouter.put("/", (req, res) => {
  try {
    validateSettingsPatch(req.body ?? {});
    res.json(saveSettings(req.body ?? {}));
  } catch (err) {
    if (err instanceof SettingsError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});
