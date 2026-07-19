/**
 * Cross-segment data aggregation. Used by segment routes, the score engine,
 * and agent tools — keep all "what happened on day X" logic here so every
 * consumer agrees on the numbers.
 */
import { db, daysAgoStr } from "./db";
import { getSettings } from "./settingsStore";
import { NUTRIENTS } from "../nutrients";
import type {
  CardioSession,
  DailyNutritionSummary,
  DailyVitaminSummary,
  Food,
  FoodLog,
  MacroTotals,
  MealType,
  MobilityDaySummary,
  MobilityKind,
  MobilitySession,
  NutrientCoverage,
  SleepLog,
  Supplement,
  SupplementLog,
  WeightLog,
} from "../types";

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase shared types)
// ---------------------------------------------------------------------------

export function mapFood(r: any): Food {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    servingSize: r.serving_size,
    servingUnit: r.serving_unit,
    calories: r.calories,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    fiberG: r.fiber_g,
    sugarG: r.sugar_g,
    sodiumMg: r.sodium_mg,
    micros: safeJson(r.micros_json, {}),
    source: r.source,
    createdAt: r.created_at,
  };
}

export function mapSupplement(r: any): Supplement {
  return {
    id: r.id,
    name: r.name,
    nutrients: safeJson(r.nutrients_json, {}),
    notes: r.notes,
    active: r.active,
    createdAt: r.created_at,
  };
}

export function mapSleep(r: any): SleepLog {
  let durationHours: number | null = null;
  if (r.wake_time) {
    const ms = new Date(r.wake_time).getTime() - new Date(r.bed_time).getTime();
    durationHours = Math.round((ms / 3_600_000) * 100) / 100;
  }
  return {
    id: r.id,
    date: r.date,
    bedTime: r.bed_time,
    wakeTime: r.wake_time,
    quality: r.quality,
    notes: r.notes,
    durationHours,
  };
}

export function mapCardio(r: any): CardioSession {
  return {
    id: r.id,
    date: r.date,
    type: r.type,
    distanceKm: r.distance_km,
    durationMinutes: r.duration_minutes,
    intensity: r.intensity,
    steps: r.steps,
    estimatedStepsRun: r.estimated_steps_run,
    estimatedStepsWalked: r.estimated_steps_walked,
    report: r.report,
    notes: r.notes,
  };
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_TOTALS = (): MacroTotals => ({
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sugarG: 0,
  sodiumMg: 0,
});

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export function getFoodLogsForDate(date: string): FoodLog[] {
  const rows = db
    .prepare(
      `SELECT fl.*, f.id as f_id FROM food_logs fl JOIN foods f ON f.id = fl.food_id
       WHERE fl.date = ? ORDER BY fl.logged_at`,
    )
    .all(date) as any[];
  const foodStmt = db.prepare("SELECT * FROM foods WHERE id = ?");
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    foodId: r.food_id,
    servings: r.servings,
    meal: r.meal,
    loggedAt: r.logged_at,
    food: mapFood(foodStmt.get(r.food_id)),
  }));
}

export function getWaterMlForDate(date: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_ml), 0) AS total FROM water_logs WHERE date = ?")
    .get(date) as { total: number };
  return row.total;
}

export function getNutritionSummary(date: string): DailyNutritionSummary {
  const logs = getFoodLogsForDate(date);
  const totals = EMPTY_TOTALS();
  const byMeal: Record<MealType, MacroTotals> = {
    breakfast: EMPTY_TOTALS(),
    lunch: EMPTY_TOTALS(),
    dinner: EMPTY_TOTALS(),
    snack: EMPTY_TOTALS(),
  };
  for (const log of logs) {
    const f = log.food!;
    const mult = log.servings;
    const add = (t: MacroTotals) => {
      t.calories += f.calories * mult;
      t.proteinG += f.proteinG * mult;
      t.carbsG += f.carbsG * mult;
      t.fatG += f.fatG * mult;
      t.fiberG += f.fiberG * mult;
      t.sugarG += f.sugarG * mult;
      t.sodiumMg += f.sodiumMg * mult;
    };
    add(totals);
    add(byMeal[log.meal]);
  }
  roundTotals(totals);
  (Object.keys(byMeal) as MealType[]).forEach((m) => roundTotals(byMeal[m]));
  return {
    date,
    totals,
    goals: getSettings().goals,
    byMeal,
    waterMl: getWaterMlForDate(date),
    logs,
  };
}

function roundTotals(t: MacroTotals) {
  for (const k of Object.keys(t) as (keyof MacroTotals)[]) {
    t[k] = Math.round(t[k] * 10) / 10;
  }
}

export function getWeightHistory(days: number): WeightLog[] {
  const start = daysAgoStr(days - 1);
  return (
    db
      .prepare("SELECT * FROM weight_logs WHERE date >= ? ORDER BY date")
      .all(start) as any[]
  ).map((r) => ({ id: r.id, date: r.date, weight: r.weight, loggedAt: r.logged_at }));
}

// ---------------------------------------------------------------------------
// Vitamins
// ---------------------------------------------------------------------------

export function getVitaminSummary(date: string): DailyVitaminSummary {
  const settings = getSettings();
  const fromFood: Record<string, number> = {};
  for (const log of getFoodLogsForDate(date)) {
    const micros = log.food!.micros;
    for (const [key, value] of Object.entries(micros)) {
      if (typeof value === "number") {
        fromFood[key] = (fromFood[key] ?? 0) + value * log.servings;
      }
    }
    // fiber lives on the food macro row but is also a tracked "nutrient"
    fromFood["fiber_g"] = (fromFood["fiber_g"] ?? 0) + log.food!.fiberG * log.servings;
  }

  const takenRows = db
    .prepare(
      `SELECT sl.*, s.name AS supplement_name FROM supplement_logs sl
       JOIN supplements s ON s.id = sl.supplement_id WHERE sl.date = ?`,
    )
    .all(date) as any[];
  const supplementsTaken: SupplementLog[] = takenRows.map((r) => ({
    id: r.id,
    date: r.date,
    supplementId: r.supplement_id,
    takenAt: r.taken_at,
    supplementName: r.supplement_name,
  }));

  const fromSupplements: Record<string, number> = {};
  const suppStmt = db.prepare("SELECT * FROM supplements WHERE id = ?");
  for (const t of supplementsTaken) {
    const supp = mapSupplement(suppStmt.get(t.supplementId));
    for (const [key, value] of Object.entries(supp.nutrients)) {
      if (typeof value === "number") {
        fromSupplements[key] = (fromSupplements[key] ?? 0) + value;
      }
    }
  }

  const coverage: NutrientCoverage[] = NUTRIENTS.map((n) => {
    const override = settings.nutrientTargetOverrides[n.key];
    const target = typeof override === "number" && override > 0 ? override : n.dailyTarget;
    const food = Math.round((fromFood[n.key] ?? 0) * 100) / 100;
    const supp = Math.round((fromSupplements[n.key] ?? 0) * 100) / 100;
    const consumed = Math.round((food + supp) * 100) / 100;
    return {
      key: n.key,
      label: n.label,
      unit: n.unit,
      target,
      consumed,
      fromFood: food,
      fromSupplements: supp,
      percent: Math.min(100, Math.round((consumed / target) * 100)),
    };
  });

  const activeSupplements = (
    db.prepare("SELECT * FROM supplements WHERE active = 1 ORDER BY name").all() as any[]
  ).map(mapSupplement);

  return { date, coverage, supplementsTaken, activeSupplements };
}

// ---------------------------------------------------------------------------
// Mobility (stretching / yoga / posture)
// ---------------------------------------------------------------------------

export function mapMobilitySession(r: any): MobilitySession {
  return {
    id: r.id,
    date: r.date,
    kind: r.kind,
    routineId: r.routine_id,
    durationMinutes: r.duration_minutes,
    feel: r.feel,
    report: r.report,
    notes: r.notes,
    performedAt: r.performed_at,
    routineName: r.routine_name ?? undefined,
  };
}

export function getMobilityDaySummary(date: string): MobilityDaySummary {
  const sessions = (
    db
      .prepare(
        `SELECT ms.*, mr.name AS routine_name FROM mobility_sessions ms
         LEFT JOIN mobility_routines mr ON mr.id = ms.routine_id
         WHERE ms.date = ? ORDER BY ms.performed_at`,
      )
      .all(date) as any[]
  ).map(mapMobilitySession);

  const byKind: Partial<Record<MobilityKind, number>> = {};
  let totalMinutes = 0;
  for (const s of sessions) {
    totalMinutes += s.durationMinutes;
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  }

  const assessmentsToday = (
    db
      .prepare(
        `SELECT ma.*, mm.name AS metric_name FROM mobility_assessments ma
         JOIN mobility_metrics mm ON mm.id = ma.metric_id
         WHERE ma.date = ? ORDER BY ma.logged_at`,
      )
      .all(date) as any[]
  ).map((r) => ({
    id: r.id,
    date: r.date,
    metricId: r.metric_id,
    score: r.score,
    notes: r.notes,
    loggedAt: r.logged_at,
    metricName: r.metric_name,
  }));

  const metricsLatest = (
    db
      .prepare(
        `SELECT mm.id, mm.name, mm.direction, ma.score AS latest_score, ma.date AS latest_date
         FROM mobility_metrics mm
         LEFT JOIN mobility_assessments ma ON ma.id = (
           SELECT id FROM mobility_assessments
           WHERE metric_id = mm.id AND date <= ? ORDER BY date DESC, id DESC LIMIT 1
         )
         WHERE mm.active = 1 ORDER BY mm.name`,
      )
      .all(date) as any[]
  ).map((r) => ({
    metricId: r.id,
    name: r.name,
    direction: r.direction,
    latestScore: r.latest_score ?? null,
    latestDate: r.latest_date ?? null,
  }));

  return {
    date,
    sessions,
    totalMinutes: Math.round(totalMinutes * 10) / 10,
    byKind,
    assessmentsToday,
    metricsLatest,
  };
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

export function getSleepForDate(date: string): SleepLog | null {
  // Completed logs only — an open "going to bed" log (wake_time NULL) carries a
  // provisional date and must not shadow the finished night for scoring/tiles.
  const row = db
    .prepare(
      "SELECT * FROM sleep_logs WHERE date = ? AND wake_time IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(date) as any;
  return row ? mapSleep(row) : null;
}

export function getSleepHistory(days: number): SleepLog[] {
  const start = daysAgoStr(days - 1);
  return (
    db.prepare("SELECT * FROM sleep_logs WHERE date >= ? ORDER BY date").all(start) as any[]
  ).map(mapSleep);
}

// ---------------------------------------------------------------------------
// Workout
// ---------------------------------------------------------------------------

export interface WorkoutDaySummary {
  date: string;
  sessions: { id: number; name: string; completedAt: string | null; setCount: number }[];
  cardio: CardioSession[];
  /** plan days scheduled for this weekday across non-archived plans */
  scheduledPlanDays: { id: number; planId: number; planName: string; name: string }[];
}

export function getWorkoutDaySummary(date: string): WorkoutDaySummary {
  const sessions = (
    db.prepare("SELECT * FROM workout_sessions WHERE date = ?").all(date) as any[]
  ).map((s) => ({
    id: s.id,
    name: s.name,
    completedAt: s.completed_at,
    setCount: (
      db
        .prepare("SELECT COUNT(*) AS c FROM session_sets WHERE session_id = ?")
        .get(s.id) as { c: number }
    ).c,
  }));

  const cardio = (
    db.prepare("SELECT * FROM cardio_sessions WHERE date = ?").all(date) as any[]
  ).map(mapCardio);

  const dow = new Date(`${date}T12:00:00`).getDay();
  // A plan only "schedules" dates on/after its creation — otherwise creating a
  // plan today would retroactively mark every past matching weekday as skipped.
  const scheduledPlanDays = db
    .prepare(
      `SELECT pd.id, pd.plan_id AS planId, wp.name AS planName, pd.name
       FROM plan_days pd JOIN workout_plans wp ON wp.id = pd.plan_id
       WHERE pd.day_of_week = ? AND wp.archived = 0 AND date(wp.created_at) <= ?`,
    )
    .all(dow, date) as any[];

  return { date, sessions, cardio, scheduledPlanDays };
}

/**
 * Estimate run vs walked steps for a cardio session.
 * Stride heuristics: running ~0.95m/step at faster paces, walking ~0.7m/step.
 * Interval sessions assume a 60/40 run/walk distance split.
 */
export function estimateSteps(
  type: CardioSession["type"],
  distanceKm: number,
): { run: number; walked: number } {
  const meters = distanceKm * 1000;
  const RUN_STRIDE = 0.95;
  const JOG_STRIDE = 0.85;
  const WALK_STRIDE = 0.7;
  switch (type) {
    case "run":
      return { run: Math.round(meters / RUN_STRIDE), walked: 0 };
    case "jog":
      return { run: Math.round(meters / JOG_STRIDE), walked: 0 };
    case "walk":
      return { run: 0, walked: Math.round(meters / WALK_STRIDE) };
    case "interval": {
      const runMeters = meters * 0.6;
      const walkMeters = meters * 0.4;
      return {
        run: Math.round(runMeters / RUN_STRIDE),
        walked: Math.round(walkMeters / WALK_STRIDE),
      };
    }
  }
}
