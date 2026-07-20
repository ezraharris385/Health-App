/**
 * Nutrition data store: food library CRUD, per-meal daily food log,
 * day-aligned calorie/macro history, water tracking, and daily weight log
 * (one entry per day, upsert).
 *
 * Runtime-agnostic — runs in Node (server mode) and the browser (local mode)
 * through the injected DB handle. Consumed by the Express router
 * (server/routes/nutrition.ts), the in-browser router
 * (client/src/local/api/nutrition.ts), and the nutrition agent
 * (shared/agents/defs/nutrition.ts), so all three share the exact same
 * validation and write paths.
 */
import { db, dateRange, daysAgoStr, isValidDateStr, todayStr } from "../db";
import { mapFood } from "../summaries";
import { NUTRIENT_BY_KEY, NUTRIENT_KEYS } from "../../nutrients";
import type { Food, FoodLog, MealType, MicroMap, WaterLog, WeightLog } from "../../types";

export class BadRequestError extends Error {}
export class NotFoundError extends Error {}

export const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function toNum(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BadRequestError(`${field} must be a number`);
  if (opts.min !== undefined && n < opts.min)
    throw new BadRequestError(`${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max)
    throw new BadRequestError(`${field} must be <= ${opts.max}`);
  return n;
}

function optNum(
  v: unknown,
  field: string,
  def: number,
  opts: { min?: number; max?: number } = {},
): number {
  if (v === undefined || v === null || v === "") return def;
  return toNum(v, field, opts);
}

/** Validate a YYYY-MM-DD date; fall back to `def` when absent. */
export function parseDate(v: unknown, def?: string): string {
  if (v === undefined || v === null || v === "") {
    if (def !== undefined) return def;
    throw new BadRequestError("date is required (YYYY-MM-DD)");
  }
  if (!isValidDateStr(v)) throw new BadRequestError("date must be YYYY-MM-DD");
  return v;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Clamp a `days` query value to [1, 365]; fall back to `def` when absent. */
export function clampDays(v: unknown, def: number): number {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequestError("days must be a number");
  return Math.min(365, Math.max(1, Math.round(n)));
}

/**
 * Validate a micros map against shared/nutrients keys.
 * Unknown keys throw (catches typos from both the UI and the agent).
 * fiber_g is dropped silently: fiber is stored on the fiberG macro column and
 * getVitaminSummary already counts it from there — keeping it in micros too
 * would double count it.
 */
export function sanitizeMicros(input: unknown): MicroMap {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new BadRequestError("micros must be an object map of nutrientKey -> amount");
  const out: MicroMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "fiber_g") continue;
    if (!NUTRIENT_BY_KEY[key]) {
      throw new BadRequestError(
        `Unknown micro key "${key}". Valid keys: ${NUTRIENT_KEYS.join(", ")}`,
      );
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
      throw new BadRequestError(`micros.${key} must be a non-negative number`);
    if (n > 0) out[key] = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Food library
// ---------------------------------------------------------------------------

export function listFoods(q?: string, limit = 300): Food[] {
  const rows = q?.trim()
    ? (db
        .prepare(
          `SELECT * FROM foods WHERE name LIKE ? COLLATE NOCASE OR brand LIKE ? COLLATE NOCASE
           ORDER BY name LIMIT ?`,
        )
        .all(`%${q.trim()}%`, `%${q.trim()}%`, limit) as any[])
    : (db.prepare("SELECT * FROM foods ORDER BY name LIMIT ?").all(limit) as any[]);
  return rows.map(mapFood);
}

export function getFoodById(id: number): Food | null {
  const row = db.prepare("SELECT * FROM foods WHERE id = ?").get(id);
  return row ? mapFood(row) : null;
}

function requireFood(id: number): Food {
  const food = getFoodById(id);
  if (!food) throw new NotFoundError(`No food #${id}`);
  return food;
}

export function createFood(input: any, defaultSource: "user" | "ai" = "user"): Food {
  if (!input || typeof input !== "object") throw new BadRequestError("body must be an object");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new BadRequestError("name is required");
  const brand = typeof input.brand === "string" ? input.brand.trim() : "";
  const servingUnit =
    typeof input.servingUnit === "string" && input.servingUnit.trim()
      ? input.servingUnit.trim()
      : "serving";
  const source = input.source === "ai" || input.source === "user" ? input.source : defaultSource;
  const micros = sanitizeMicros(input.micros);
  const info = db
    .prepare(
      `INSERT INTO foods
         (name, brand, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g,
          fiber_g, sugar_g, sodium_mg, micros_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      brand,
      optNum(input.servingSize, "servingSize", 1, { min: 0.001 }),
      servingUnit,
      optNum(input.calories, "calories", 0, { min: 0 }),
      optNum(input.proteinG, "proteinG", 0, { min: 0 }),
      optNum(input.carbsG, "carbsG", 0, { min: 0 }),
      optNum(input.fatG, "fatG", 0, { min: 0 }),
      optNum(input.fiberG, "fiberG", 0, { min: 0 }),
      optNum(input.sugarG, "sugarG", 0, { min: 0 }),
      optNum(input.sodiumMg, "sodiumMg", 0, { min: 0 }),
      JSON.stringify(micros),
      source,
    );
  return requireFood(Number(info.lastInsertRowid));
}

export function updateFood(id: number, patch: any): Food {
  const cur = requireFood(id);
  if (!patch || typeof patch !== "object") throw new BadRequestError("body must be an object");
  const name = patch.name !== undefined ? String(patch.name).trim() : cur.name;
  if (!name) throw new BadRequestError("name cannot be empty");
  const brand = patch.brand !== undefined ? String(patch.brand).trim() : cur.brand;
  const servingUnit =
    patch.servingUnit !== undefined ? String(patch.servingUnit).trim() || "serving" : cur.servingUnit;
  const source =
    patch.source === "ai" || patch.source === "user" ? patch.source : cur.source;
  const micros = patch.micros !== undefined ? sanitizeMicros(patch.micros) : cur.micros;
  const numField = (key: string, curVal: number, min = 0) =>
    patch[key] !== undefined ? toNum(patch[key], key, { min }) : curVal;
  db.prepare(
    `UPDATE foods SET name = ?, brand = ?, serving_size = ?, serving_unit = ?, calories = ?,
       protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, sugar_g = ?, sodium_mg = ?,
       micros_json = ?, source = ? WHERE id = ?`,
  ).run(
    name,
    brand,
    numField("servingSize", cur.servingSize, 0.001),
    servingUnit,
    numField("calories", cur.calories),
    numField("proteinG", cur.proteinG),
    numField("carbsG", cur.carbsG),
    numField("fatG", cur.fatG),
    numField("fiberG", cur.fiberG),
    numField("sugarG", cur.sugarG),
    numField("sodiumMg", cur.sodiumMg),
    JSON.stringify(micros),
    source,
    id,
  );
  return requireFood(id);
}

/** Deletes a food; its food_logs cascade-delete with it. */
export function deleteFood(id: number): void {
  requireFood(id);
  db.prepare("DELETE FROM foods WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Food log
// ---------------------------------------------------------------------------

function mapFoodLogRow(row: any, food?: Food | null): FoodLog {
  return {
    id: row.id,
    date: row.date,
    foodId: row.food_id,
    servings: row.servings,
    meal: row.meal,
    loggedAt: row.logged_at,
    food: food ?? undefined,
  };
}

export function createFoodLog(args: {
  date?: unknown;
  foodId: unknown;
  servings?: unknown;
  meal?: unknown;
}): FoodLog {
  const date = parseDate(args.date, todayStr());
  const foodId = Math.round(toNum(args.foodId, "foodId", { min: 1 }));
  const food = requireFood(foodId);
  const servings = optNum(args.servings, "servings", 1, { min: 0.01, max: 100 });
  const meal = args.meal === undefined || args.meal === null ? "snack" : String(args.meal);
  if (!MEALS.includes(meal as MealType))
    throw new BadRequestError(`meal must be one of: ${MEALS.join(", ")}`);
  const info = db
    .prepare("INSERT INTO food_logs (date, food_id, servings, meal) VALUES (?, ?, ?, ?)")
    .run(date, foodId, servings, meal);
  const row = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(Number(info.lastInsertRowid));
  return mapFoodLogRow(row, food);
}

export function updateFoodLog(
  id: number,
  patch: { date?: unknown; servings?: unknown; meal?: unknown },
): FoodLog {
  const row = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as any;
  if (!row) throw new NotFoundError(`No food log #${id}`);
  const date = patch.date !== undefined ? parseDate(patch.date) : row.date;
  const servings =
    patch.servings !== undefined
      ? toNum(patch.servings, "servings", { min: 0.01, max: 100 })
      : row.servings;
  const meal = patch.meal !== undefined ? String(patch.meal) : row.meal;
  if (!MEALS.includes(meal as MealType))
    throw new BadRequestError(`meal must be one of: ${MEALS.join(", ")}`);
  db.prepare("UPDATE food_logs SET date = ?, servings = ?, meal = ? WHERE id = ?").run(
    date,
    servings,
    meal,
    id,
  );
  const next = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as any;
  return mapFoodLogRow(next, getFoodById(next.food_id));
}

/** Returns the deleted log (with its food) so callers can confirm what was removed. */
export function deleteFoodLog(id: number): FoodLog {
  const row = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as any;
  if (!row) throw new NotFoundError(`No food log #${id}`);
  const food = getFoodById(row.food_id);
  db.prepare("DELETE FROM food_logs WHERE id = ?").run(id);
  return mapFoodLogRow(row, food);
}

// ---------------------------------------------------------------------------
// History (day-aligned, zero-filled)
// ---------------------------------------------------------------------------

export interface MacroHistoryDay {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function getMacroHistory(days: number): MacroHistoryDay[] {
  const end = todayStr();
  const start = daysAgoStr(Math.max(1, days) - 1);
  const rows = db
    .prepare(
      `SELECT fl.date AS date,
              SUM(f.calories * fl.servings) AS calories,
              SUM(f.protein_g * fl.servings) AS protein_g,
              SUM(f.carbs_g * fl.servings) AS carbs_g,
              SUM(f.fat_g * fl.servings) AS fat_g
       FROM food_logs fl JOIN foods f ON f.id = fl.food_id
       WHERE fl.date >= ? AND fl.date <= ?
       GROUP BY fl.date`,
    )
    .all(start, end) as any[];
  const byDate = new Map<string, any>(rows.map((r) => [r.date, r]));
  return dateRange(start, end).map((date) => {
    const r = byDate.get(date);
    return {
      date,
      calories: round1(r?.calories ?? 0),
      proteinG: round1(r?.protein_g ?? 0),
      carbsG: round1(r?.carbs_g ?? 0),
      fatG: round1(r?.fat_g ?? 0),
    };
  });
}

export interface WaterHistoryDay {
  date: string;
  totalMl: number;
}

export function getWaterHistoryDays(days: number): WaterHistoryDay[] {
  const end = todayStr();
  const start = daysAgoStr(Math.max(1, days) - 1);
  const rows = db
    .prepare(
      `SELECT date, SUM(amount_ml) AS total FROM water_logs
       WHERE date >= ? AND date <= ? GROUP BY date`,
    )
    .all(start, end) as any[];
  const byDate = new Map<string, number>(rows.map((r) => [r.date, r.total]));
  return dateRange(start, end).map((date) => ({
    date,
    totalMl: Math.round(byDate.get(date) ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

function mapWaterRow(row: any): WaterLog {
  return { id: row.id, date: row.date, amountMl: row.amount_ml, loggedAt: row.logged_at };
}

export function listWaterForDate(date: string): WaterLog[] {
  return (
    db.prepare("SELECT * FROM water_logs WHERE date = ? ORDER BY logged_at, id").all(date) as any[]
  ).map(mapWaterRow);
}

export function addWater(amountMl: unknown, date?: unknown): WaterLog {
  const d = parseDate(date, todayStr());
  const ml = toNum(amountMl, "amountMl", { min: 1, max: 10000 });
  const info = db.prepare("INSERT INTO water_logs (date, amount_ml) VALUES (?, ?)").run(d, ml);
  return mapWaterRow(
    db.prepare("SELECT * FROM water_logs WHERE id = ?").get(Number(info.lastInsertRowid)),
  );
}

export function deleteWater(id: number): void {
  const info = db.prepare("DELETE FROM water_logs WHERE id = ?").run(id);
  if (!info.changes) throw new NotFoundError(`No water log #${id}`);
}

// ---------------------------------------------------------------------------
// Weight (one entry per day; upsert)
// ---------------------------------------------------------------------------

export function upsertWeight(weight: unknown, date?: unknown): WeightLog {
  const d = parseDate(date, todayStr());
  const w = toNum(weight, "weight", { min: 1, max: 2000 });
  db.prepare(
    `INSERT INTO weight_logs (date, weight) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET weight = excluded.weight, logged_at = datetime('now')`,
  ).run(d, w);
  const row = db.prepare("SELECT * FROM weight_logs WHERE date = ?").get(d) as any;
  return { id: row.id, date: row.date, weight: row.weight, loggedAt: row.logged_at };
}

export function deleteWeight(id: number): void {
  const info = db.prepare("DELETE FROM weight_logs WHERE id = ?").run(id);
  if (!info.changes) throw new NotFoundError(`No weight log #${id}`);
}

// ---------------------------------------------------------------------------
// Supplement macro contribution (read-only; display breakdown)
// ---------------------------------------------------------------------------

export interface SupplementMacroContribution {
  date: string;
  /** how many taken-supplement rows contributed macros on this date */
  count: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sugarG: number;
  sodiumMg: number;
}

/**
 * Macros contributed by taken supplements on a date. getNutritionSummary
 * (Foundation) already ADDS these into the day's totals; this is a read-only
 * breakdown so the UI can surface "incl. N kcal from supplements" without
 * re-adding anything (no double counting). Mirrors the summing query in
 * getNutritionSummary exactly (one row per taken supplement_log).
 */
export function getSupplementMacroContribution(date: string): SupplementMacroContribution {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(s.calories), 0) AS calories,
              COALESCE(SUM(s.protein_g), 0) AS protein_g,
              COALESCE(SUM(s.carbs_g), 0) AS carbs_g,
              COALESCE(SUM(s.fat_g), 0) AS fat_g,
              COALESCE(SUM(s.sugar_g), 0) AS sugar_g,
              COALESCE(SUM(s.sodium_mg), 0) AS sodium_mg
       FROM supplement_logs sl JOIN supplements s ON s.id = sl.supplement_id
       WHERE sl.date = ?`,
    )
    .get(date) as any;
  return {
    date,
    count: row?.count ?? 0,
    calories: round1(row?.calories ?? 0),
    proteinG: round1(row?.protein_g ?? 0),
    carbsG: round1(row?.carbs_g ?? 0),
    fatG: round1(row?.fat_g ?? 0),
    sugarG: round1(row?.sugar_g ?? 0),
    sodiumMg: Math.round(row?.sodium_mg ?? 0),
  };
}
