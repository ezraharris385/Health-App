import { Router } from "express";
import { getSettings, saveSettings } from "../settingsStore";
import { NUTRIENT_BY_KEY } from "../../shared/nutrients";
import type { Settings } from "../../shared/types";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getSettings());
});

class SettingsError extends Error {}

function posNum(obj: Record<string, unknown>, key: string): void {
  if (obj[key] === undefined) return;
  const n = obj[key];
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new SettingsError(`${key} must be a positive number`);
  }
}

function posNumOrNull(obj: Record<string, unknown>, key: string): void {
  if (obj[key] === undefined || obj[key] === null) return;
  posNum(obj, key);
}

function str(obj: Record<string, unknown>, key: string): void {
  if (obj[key] !== undefined && typeof obj[key] !== "string") {
    throw new SettingsError(`${key} must be a string`);
  }
}

function oneOf(obj: Record<string, unknown>, key: string, allowed: (string | null)[]): void {
  if (obj[key] === undefined) return;
  if (!allowed.includes(obj[key] as string | null)) {
    throw new SettingsError(`${key} must be one of: ${allowed.map(String).join(", ")}`);
  }
}

/** Validate a settings patch; throws SettingsError with a clear message. */
export function validateSettingsPatch(patch: Partial<Settings>): void {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new SettingsError("body must be an object");
  }
  if (patch.goals !== undefined) {
    if (typeof patch.goals !== "object" || patch.goals === null || Array.isArray(patch.goals)) {
      throw new SettingsError("goals must be an object");
    }
    const g = patch.goals as unknown as Record<string, unknown>;
    for (const k of [
      "calorieGoal",
      "proteinGoalG",
      "carbsGoalG",
      "fatGoalG",
      "waterGoalMl",
      "sleepTargetHours",
    ]) {
      posNum(g, k);
    }
    posNumOrNull(g, "weightGoal");
    oneOf(g, "weightUnit", ["lb", "kg"]);
    str(g, "goalStatement");
  }
  if (patch.profile !== undefined) {
    if (typeof patch.profile !== "object" || patch.profile === null || Array.isArray(patch.profile)) {
      throw new SettingsError("profile must be an object");
    }
    const p = patch.profile as unknown as Record<string, unknown>;
    str(p, "name");
    str(p, "notes");
    posNumOrNull(p, "age");
    posNumOrNull(p, "heightCm");
    oneOf(p, "sex", ["male", "female", "other", null]);
    oneOf(p, "activityLevel", [
      "sedentary",
      "light",
      "moderate",
      "active",
      "very_active",
      null,
    ]);
  }
  if (patch.nutrientTargetOverrides !== undefined) {
    const o = patch.nutrientTargetOverrides;
    if (typeof o !== "object" || o === null || Array.isArray(o)) {
      throw new SettingsError("nutrientTargetOverrides must be an object");
    }
    for (const [key, value] of Object.entries(o)) {
      if (!NUTRIENT_BY_KEY[key]) throw new SettingsError(`Unknown nutrient key "${key}"`);
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
        throw new SettingsError(`Override for ${key} must be a positive number (or null to clear)`);
      }
    }
  }
}

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
