/**
 * Energy model: calorie burn and caloric balance ("energy") math.
 *
 * Pure functions only — no DB access. Callers pass plain inputs (weight in lb,
 * height in cm, age, sex, activity level, per-session cardio/strength facts) and
 * the DB gathering lives in shared/data/summaries.ts (getEnergyBalance).
 *
 * Weight is taken in lb (the app's canonical body-weight unit) and converted to
 * kg internally where the underlying formulas need kg.
 */

const LB_TO_KG = 0.45359237; // 1 lb = 0.45359237 kg

export interface BmrInput {
  weightLb: number | null | undefined;
  heightCm: number | null | undefined;
  age: number | null | undefined;
  sex: "male" | "female" | "other" | null | undefined;
}

/**
 * Mifflin-St Jeor basal metabolic rate (kcal/day). Returns null when weight,
 * height, or age is missing or non-positive. Sex offset: male +5, female -161,
 * other/unknown -78 (the male/female midpoint).
 */
export function bmrMifflin({ weightLb, heightCm, age, sex }: BmrInput): number | null {
  if (weightLb == null || heightCm == null || age == null) return null;
  if (weightLb <= 0 || heightCm <= 0 || age <= 0) return null;
  const kg = weightLb * LB_TO_KG;
  let base = 10 * kg + 6.25 * heightCm - 5 * age;
  if (sex === "male") base += 5;
  else if (sex === "female") base -= 161;
  else base -= 78; // 'other' / null → midpoint
  return base;
}

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

/** Activity multipliers applied to BMR to get TDEE. */
export const ACTIVITY_MULT: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/**
 * Total daily energy expenditure = BMR × activity multiplier. Unknown or
 * missing activity level falls back to sedentary (1.2). Null BMR → null.
 */
export function tdee(
  bmr: number | null,
  activityLevel: string | null | undefined,
): number | null {
  if (bmr == null) return null;
  return bmr * (ACTIVITY_MULT[activityLevel as ActivityLevel] ?? 1.2);
}

/** MET values per cardio type (fallback 6.0 for anything unlisted). */
export const CARDIO_MET: Record<string, number> = {
  walk: 3.5,
  jog: 7.0,
  run: 9.8,
  interval: 8.0,
  hiit: 8.0,
  cycling: 7.0,
  rowing: 7.0,
  elliptical: 7.0,
  other: 6.0,
};

export interface CardioBurnInput {
  type: string;
  durationMinutes?: number | null;
  /** manually entered total steps; null → fall back to the estimates */
  steps?: number | null;
  estimatedStepsRun?: number | null;
  estimatedStepsWalked?: number | null;
}

/**
 * Calories burned by one cardio session (rounded). Prefers a MET × kg × hours
 * estimate when a duration is present; otherwise falls back to steps × 0.045
 * (manual total, else estimated run + walked). Returns 0 when neither applies.
 */
export function cardioBurn(session: CardioBurnInput, weightLb: number | null | undefined): number {
  const kg = (weightLb ?? 0) * LB_TO_KG;
  const durationMinutes = session.durationMinutes ?? 0;
  if (durationMinutes > 0) {
    const met = CARDIO_MET[session.type] ?? 6;
    return Math.round(met * kg * (durationMinutes / 60));
  }
  const steps =
    session.steps ?? (session.estimatedStepsRun ?? 0) + (session.estimatedStepsWalked ?? 0);
  if (steps > 0) return Math.round(steps * 0.045);
  return 0;
}

export interface StrengthBurnInput {
  setCount: number;
  weightLb: number | null | undefined;
}

/**
 * Rough calories burned by a strength session (rounded). This is an ESTIMATE:
 * MET 5.0 × kg × (setCount × 0.75 min per set / 60). Returns 0 without a valid
 * body weight or when no sets were logged.
 */
export function strengthBurn({ setCount, weightLb }: StrengthBurnInput): number {
  const kg = (weightLb ?? 0) * LB_TO_KG;
  if (kg <= 0 || setCount <= 0) return 0;
  return Math.round(5.0 * kg * ((setCount * 0.75) / 60));
}
