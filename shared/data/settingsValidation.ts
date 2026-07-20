/**
 * Settings patch validation, shared by both runtimes: the Express settings
 * route (server mode) and the in-browser settings dispatcher (local mode).
 * Throws SettingsError with a clear message; callers map it to a 400.
 */
import { NUTRIENT_BY_KEY } from "../nutrients";
import { SCORE_PRESETS, SEGMENT_KEYS } from "./scoreWeights";
import type { Settings } from "../types";

export class SettingsError extends Error {}

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
  if (patch.scoreWeights !== undefined) {
    const sw = patch.scoreWeights;
    if (typeof sw !== "object" || sw === null || Array.isArray(sw)) {
      throw new SettingsError("scoreWeights must be an object");
    }
    const allowed = new Set<string>(SEGMENT_KEYS);
    for (const [key, value] of Object.entries(sw as Record<string, unknown>)) {
      if (!allowed.has(key)) throw new SettingsError(`Unknown score segment "${key}"`);
      // normalizeWeights handles the all-zero case, so 0 is accepted here.
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new SettingsError(`scoreWeights.${key} must be a finite number >= 0`);
      }
    }
  }
  if (patch.scoreGoalPreset !== undefined) {
    if (typeof patch.scoreGoalPreset !== "string") {
      throw new SettingsError("scoreGoalPreset must be a string");
    }
    const validPresets = [...Object.keys(SCORE_PRESETS), "custom"];
    if (!validPresets.includes(patch.scoreGoalPreset)) {
      throw new SettingsError(`scoreGoalPreset must be one of: ${validPresets.join(", ")}`);
    }
  }
}
