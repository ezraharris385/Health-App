import { db } from "./db";
import type { Settings, UserGoals, UserProfile } from "../types";

const DEFAULT_GOALS: UserGoals = {
  calorieGoal: 2200,
  proteinGoalG: 150,
  carbsGoalG: 220,
  fatGoalG: 75,
  waterGoalMl: 3000,
  sleepTargetHours: 8,
  weightGoal: null,
  weightUnit: "lb",
  goalStatement: "",
};

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  age: null,
  heightCm: null,
  sex: null,
  activityLevel: null,
  notes: "",
};

export function getSettings(): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
    | { value: string }
    | undefined;
  const stored = row ? (JSON.parse(row.value) as Partial<Settings>) : {};
  return {
    profile: { ...DEFAULT_PROFILE, ...(stored.profile ?? {}) },
    goals: { ...DEFAULT_GOALS, ...(stored.goals ?? {}) },
    nutrientTargetOverrides: stored.nutrientTargetOverrides ?? {},
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next: Settings = {
    profile: { ...current.profile, ...(patch.profile ?? {}) },
    goals: { ...current.goals, ...(patch.goals ?? {}) },
    nutrientTargetOverrides: {
      ...current.nutrientTargetOverrides,
      ...(patch.nutrientTargetOverrides ?? {}),
    },
  };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(next));
  return next;
}
