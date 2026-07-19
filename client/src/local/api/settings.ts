/**
 * Local-mode settings API: registers in-browser handlers for exactly the
 * routes server/routes/settings.ts serves, backed by the same shared store
 * and validator, so client/src/api/settings.ts works identically without a
 * server. Same status codes and error messages as the Express router.
 */
import { get, put, LocalApiError } from "../router";
import { getSettings, saveSettings } from "@shared/data/settingsStore";
import {
  SettingsError,
  validateSettingsPatch,
} from "@shared/data/settingsValidation";

export function registerRoutesSettings(): void {
  get("/api/settings", () => getSettings());

  put("/api/settings", ({ body }) => {
    try {
      validateSettingsPatch(body ?? {});
      return saveSettings(body ?? {});
    } catch (err) {
      if (err instanceof SettingsError) throw new LocalApiError(400, err.message);
      throw err;
    }
  });
}
