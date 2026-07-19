/**
 * Vitamins data store: daily micronutrient coverage (from
 * summaries.getVitaminSummary), supplement library management, one-tap
 * taken/untaken toggling (unique per date), coverage history and supplement
 * adherence history.
 *
 * Runtime-agnostic — runs in Node (server mode) and the browser (local mode)
 * through the injected DB handle. Consumed by the Express router
 * (server/routes/vitamins.ts), the in-browser router
 * (client/src/local/api/vitamins.ts), and the vitamins agent
 * (shared/agents/defs/vitamins.ts), so all three share the exact same
 * validation and write paths.
 */
import { db, dateRange, daysAgoStr, isValidDateStr, todayStr } from "../db";
import { getVitaminSummary, mapSupplement } from "../summaries";
import { getSettings } from "../settingsStore";
import { NUTRIENT_BY_KEY, NUTRIENT_KEYS } from "../../nutrients";
import type { MicroMap, Supplement } from "../../types";

export class BadRequestError extends Error {}
export class NotFoundError extends Error {}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate a YYYY-MM-DD date; fall back to `def` when absent. */
export function parseDate(v: unknown, def?: string): string {
  if (v === undefined || v === null || v === "") {
    if (def !== undefined) return def;
    throw new BadRequestError("date is required (YYYY-MM-DD)");
  }
  if (!isValidDateStr(v)) throw new BadRequestError("date must be YYYY-MM-DD");
  return v;
}

export function parseDays(v: unknown, def: number, max = 365): number {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new BadRequestError(`days must be an integer between 1 and ${max}`);
  return n;
}

export function parseId(v: unknown, field = "id"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestError(`${field} must be a positive integer`);
  return n;
}

/**
 * Validate a supplement's per-dose nutrient map against shared/nutrients keys.
 * Unknown keys throw (catches typos from both the UI and the agent); values
 * must be non-negative numbers; zero/absent entries are dropped.
 * (Unlike food micros, fiber_g IS allowed here — e.g. psyllium — and
 * getVitaminSummary counts supplement nutrients generically by key.)
 */
export function sanitizeNutrients(input: unknown): MicroMap {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new BadRequestError("nutrients must be an object map of nutrientKey -> amount per dose");
  const out: MicroMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!NUTRIENT_BY_KEY[key]) {
      throw new BadRequestError(
        `Unknown nutrient key "${key}". Valid keys: ${NUTRIENT_KEYS.join(", ")}`,
      );
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
      throw new BadRequestError(`nutrients.${key} must be a non-negative number`);
    if (n > 0) out[key] = n;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Supplement library
// ---------------------------------------------------------------------------

export function listSupplements(): Supplement[] {
  const rows = db
    .prepare("SELECT * FROM supplements ORDER BY active DESC, name COLLATE NOCASE")
    .all() as any[];
  return rows.map(mapSupplement);
}

export function getSupplementById(id: number): Supplement | null {
  const row = db.prepare("SELECT * FROM supplements WHERE id = ?").get(id);
  return row ? mapSupplement(row) : null;
}

function requireSupplement(id: number): Supplement {
  const s = getSupplementById(id);
  if (!s) throw new NotFoundError(`No supplement #${id}`);
  return s;
}

export function createSupplement(input: any): Supplement {
  if (!input || typeof input.name !== "string" || !input.name.trim())
    throw new BadRequestError("name is required");
  const nutrients = sanitizeNutrients(input.nutrients);
  const notes = typeof input.notes === "string" ? input.notes : "";
  const info = db
    .prepare("INSERT INTO supplements (name, nutrients_json, notes, active) VALUES (?, ?, ?, 1)")
    .run(input.name.trim(), JSON.stringify(nutrients), notes);
  return getSupplementById(Number(info.lastInsertRowid))!;
}

export function updateSupplement(id: number, patch: any): Supplement {
  const current = requireSupplement(id);
  if (!patch || typeof patch !== "object") throw new BadRequestError("body must be an object");
  const name = patch.name !== undefined ? String(patch.name).trim() : current.name;
  if (!name) throw new BadRequestError("name cannot be empty");
  const nutrients =
    patch.nutrients !== undefined ? sanitizeNutrients(patch.nutrients) : current.nutrients;
  const notes = patch.notes !== undefined ? String(patch.notes) : current.notes;
  let active: 0 | 1 = current.active;
  if (patch.active !== undefined) {
    if (patch.active === 1 || patch.active === true) active = 1;
    else if (patch.active === 0 || patch.active === false) active = 0;
    else throw new BadRequestError("active must be a boolean or 0/1");
  }
  db.prepare("UPDATE supplements SET name = ?, nutrients_json = ?, notes = ?, active = ? WHERE id = ?").run(
    name,
    JSON.stringify(nutrients),
    notes,
    active,
    id,
  );
  return getSupplementById(id)!;
}

export function deleteSupplement(id: number): void {
  requireSupplement(id);
  db.prepare("DELETE FROM supplements WHERE id = ?").run(id); // cascades supplement_logs
}

// ---------------------------------------------------------------------------
// Taken / untaken toggle (unique per date)
// ---------------------------------------------------------------------------

export interface TakenState {
  date: string;
  supplementId: number;
  supplementName: string;
  taken: boolean;
}

/**
 * Set (or toggle, when `taken` is omitted) whether a supplement was taken on
 * `date`. Uniqueness per (date, supplement) is enforced with INSERT OR IGNORE
 * on write and DELETE on untake.
 */
export function setTaken(supplementId: number, date: string, taken?: boolean): TakenState {
  const supp = requireSupplement(supplementId);
  const exists = !!db
    .prepare("SELECT id FROM supplement_logs WHERE date = ? AND supplement_id = ?")
    .get(date, supplementId);
  const target = taken === undefined ? !exists : taken;
  if (target) {
    db.prepare("INSERT OR IGNORE INTO supplement_logs (date, supplement_id) VALUES (?, ?)").run(
      date,
      supplementId,
    );
  } else {
    db.prepare("DELETE FROM supplement_logs WHERE date = ? AND supplement_id = ?").run(
      date,
      supplementId,
    );
  }
  return { date, supplementId, supplementName: supp.name, taken: target };
}

export function takenIdsForDate(date: string): number[] {
  return (
    db.prepare("SELECT supplement_id AS id FROM supplement_logs WHERE date = ?").all(date) as {
      id: number;
    }[]
  ).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// History / trend analysis
// ---------------------------------------------------------------------------

export interface CoverageHistoryPoint {
  date: string;
  /** mean coverage percent across all tracked nutrients (0-100) */
  avgPercent: number;
}

export function getCoverageHistory(days: number): CoverageHistoryPoint[] {
  const start = daysAgoStr(days - 1);
  return dateRange(start, todayStr()).map((date) => {
    const cov = getVitaminSummary(date).coverage;
    const avg = cov.length === 0 ? 0 : cov.reduce((a, c) => a + c.percent, 0) / cov.length;
    return { date, avgPercent: Math.round(avg) };
  });
}

export interface AdherencePoint {
  date: string;
  /** supplements logged as taken that day */
  takenCount: number;
  /** currently-active supplements (denominator) */
  activeCount: number;
  /** 0-100 */
  percent: number;
}

export function getAdherenceHistory(days: number): AdherencePoint[] {
  const activeCount = (
    db.prepare("SELECT COUNT(*) AS c FROM supplements WHERE active = 1").get() as { c: number }
  ).c;
  const stmt = db.prepare("SELECT COUNT(*) AS c FROM supplement_logs WHERE date = ?");
  const start = daysAgoStr(days - 1);
  return dateRange(start, todayStr()).map((date) => {
    const takenCount = (stmt.get(date) as { c: number }).c;
    const percent =
      activeCount === 0 ? 0 : Math.min(100, Math.round((takenCount / activeCount) * 100));
    return { date, takenCount, activeCount, percent };
  });
}

export interface NutrientTrend {
  key: string;
  label: string;
  unit: string;
  target: number;
  upperLimit: number | null;
  avgPercent: number;
  avgConsumed: number;
  avgFromFood: number;
  avgFromSupplements: number;
  /** days in the window where total intake exceeded the upper limit */
  daysOverLimit: number;
}

export interface CoverageTrendAnalysis {
  days: number;
  from: string;
  to: string;
  /** all tracked nutrients, sorted worst average coverage first */
  nutrients: NutrientTrend[];
  /** keys with average coverage < 60% — the chronic gaps */
  chronicallyLow: string[];
  /** keys that exceeded their upper limit on at least one day */
  overLimit: string[];
}

export function analyzeCoverageTrends(days: number): CoverageTrendAnalysis {
  const overrides = getSettings().nutrientTargetOverrides;
  const from = daysAgoStr(days - 1);
  const to = todayStr();
  const dates = dateRange(from, to);
  const acc: Record<
    string,
    { percent: number; consumed: number; food: number; supp: number; over: number }
  > = {};
  for (const key of NUTRIENT_KEYS) acc[key] = { percent: 0, consumed: 0, food: 0, supp: 0, over: 0 };
  for (const date of dates) {
    for (const c of getVitaminSummary(date).coverage) {
      const a = acc[c.key];
      if (!a) continue;
      a.percent += c.percent;
      a.consumed += c.consumed;
      a.food += c.fromFood;
      a.supp += c.fromSupplements;
      const ul = NUTRIENT_BY_KEY[c.key]?.upperLimit;
      if (ul != null && c.consumed > ul) a.over += 1;
    }
  }
  const n = dates.length || 1;
  const nutrients: NutrientTrend[] = NUTRIENT_KEYS.map((key) => {
    const def = NUTRIENT_BY_KEY[key];
    const a = acc[key];
    // Report the same effective target getVitaminSummary uses for percentages
    // (per-user override when set, static default otherwise).
    const ov = overrides[key];
    const target = typeof ov === "number" && ov > 0 ? ov : def.dailyTarget;
    return {
      key,
      label: def.label,
      unit: def.unit,
      target,
      upperLimit: def.upperLimit,
      avgPercent: Math.round(a.percent / n),
      avgConsumed: round2(a.consumed / n),
      avgFromFood: round2(a.food / n),
      avgFromSupplements: round2(a.supp / n),
      daysOverLimit: a.over,
    };
  }).sort((x, y) => x.avgPercent - y.avgPercent);
  return {
    days,
    from,
    to,
    nutrients,
    chronicallyLow: nutrients.filter((t) => t.avgPercent < 60).map((t) => t.key),
    overLimit: nutrients.filter((t) => t.daysOverLimit > 0).map((t) => t.key),
  };
}

export interface DeficientNutrient {
  key: string;
  label: string;
  unit: string;
  percent: number;
  consumed: number;
  target: number;
  /** amount still needed today to hit the target */
  stillNeeded: number;
  upperLimit: number | null;
}

/**
 * The "what's missing today" snapshot: nutrients under 100% coverage with the
 * exact amounts still needed, sorted worst-first. Used by the agent to
 * recommend specific foods (it recommends from knowledge; it does not create
 * food rows — that belongs to the nutrition segment).
 */
export function getDeficiencyContext(date: string): {
  date: string;
  totalTracked: number;
  fullyCovered: number;
  deficient: DeficientNutrient[];
} {
  const cov = getVitaminSummary(date).coverage;
  const deficient = cov
    .filter((c) => c.percent < 100)
    .sort((a, b) => a.percent - b.percent)
    .map((c) => ({
      key: c.key,
      label: c.label,
      unit: c.unit,
      percent: c.percent,
      consumed: c.consumed,
      target: c.target,
      stillNeeded: round2(Math.max(0, c.target - c.consumed)),
      upperLimit: NUTRIENT_BY_KEY[c.key]?.upperLimit ?? null,
    }));
  return { date, totalTracked: cov.length, fullyCovered: cov.length - deficient.length, deficient };
}
