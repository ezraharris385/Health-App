/**
 * Mobility data store: the stretch/yoga/posture bank, routines with ordered
 * items, session logging (duration, feel, qualitative report), user-defined
 * 1-10 metrics with direction-aware assessments, and per-day session history.
 *
 * Runtime-agnostic — runs in Node (server mode) and the browser (local mode)
 * through the injected DB handle. Consumed by the Express router
 * (server/routes/mobility.ts), the in-browser router
 * (client/src/local/api/mobility.ts), and the mobility agent
 * (shared/agents/defs/mobility.ts), so all three share the exact same
 * validation and write paths.
 */
import { db, dateRange, daysAgoStr, isValidDateStr, todayStr } from "../db";
import { mapMobilitySession } from "../summaries";
import type {
  MobilityAssessment,
  MobilityKind,
  MobilityMetric,
  MobilityRoutine,
  MobilityRoutineItem,
  MobilitySession,
  Stretch,
  StretchCategory,
} from "../../types";

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

const STRETCH_CATEGORIES: StretchCategory[] = ["stretch", "yoga", "posture"];
const MOBILITY_KINDS: MobilityKind[] = ["stretch", "yoga", "posture", "mixed"];
const DIRECTIONS: MobilityMetric["direction"][] = ["higher_better", "lower_better"];

function optStr(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string") throw new BadRequestError("Expected a string value");
  return v;
}

/** Positive integer, or null when absent/null/empty. */
function posIntOrNull(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new BadRequestError(`${field} must be a positive integer or null`);
  return n;
}

function norm01(v: unknown, field: string, def: 0 | 1): 0 | 1 {
  if (v === undefined || v === null) return def;
  if (v === 1 || v === true) return 1;
  if (v === 0 || v === false) return 0;
  throw new BadRequestError(`${field} must be a boolean or 0/1`);
}

/**
 * Name field of a partial update: undefined keeps the current name; null and
 * "" are clear attempts and rejected (a name can never be empty or "null").
 */
function normPatchName(v: unknown, current: string): string {
  if (v === undefined) return current;
  const name = v === null ? "" : String(v).trim();
  if (!name) throw new BadRequestError("name cannot be empty");
  return name;
}

function normCategory(v: unknown, def: StretchCategory): StretchCategory {
  if (v === undefined || v === null || v === "") return def;
  if (!STRETCH_CATEGORIES.includes(v as StretchCategory))
    throw new BadRequestError(`category must be one of: ${STRETCH_CATEGORIES.join(", ")}`);
  return v as StretchCategory;
}

function normKind(v: unknown, def: MobilityKind): MobilityKind {
  if (v === undefined || v === null || v === "") return def;
  if (!MOBILITY_KINDS.includes(v as MobilityKind))
    throw new BadRequestError(`kind must be one of: ${MOBILITY_KINDS.join(", ")}`);
  return v as MobilityKind;
}

function normDirection(v: unknown, def: MobilityMetric["direction"]): MobilityMetric["direction"] {
  if (v === undefined || v === null || v === "") return def;
  if (!DIRECTIONS.includes(v as MobilityMetric["direction"]))
    throw new BadRequestError(`direction must be one of: ${DIRECTIONS.join(", ")}`);
  return v as MobilityMetric["direction"];
}

function normDuration(v: unknown): number {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n) || n <= 0 || n > 600)
    throw new BadRequestError("durationMinutes must be a number > 0 and <= 600");
  return n;
}

/** 1-5 "how it felt", or null when absent/null/empty. */
function normFeel(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5)
    throw new BadRequestError("feel must be an integer between 1 and 5, or null");
  return n;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase shared types)
// ---------------------------------------------------------------------------

export function mapStretch(r: any): Stretch {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    targetAreas: r.target_areas,
    instructions: r.instructions,
    defaultHoldSeconds: r.default_hold_seconds,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export function mapRoutine(r: any): MobilityRoutine {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    focus: r.focus,
    archived: r.archived,
    createdAt: r.created_at,
  };
}

export function mapRoutineItem(r: any): MobilityRoutineItem {
  return {
    id: r.id,
    routineId: r.routine_id,
    stretchId: r.stretch_id,
    orderIndex: r.order_index,
    holdSeconds: r.hold_seconds,
    reps: r.reps,
    perSide: r.per_side,
    notes: r.notes,
    stretchName: r.stretch_name,
  };
}

export function mapMetric(r: any): MobilityMetric {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    direction: r.direction,
    active: r.active,
    createdAt: r.created_at,
  };
}

export function mapAssessment(r: any): MobilityAssessment {
  return {
    id: r.id,
    date: r.date,
    metricId: r.metric_id,
    score: r.score,
    notes: r.notes,
    loggedAt: r.logged_at,
    metricName: r.metric_name,
  };
}

// ---------------------------------------------------------------------------
// Composite shapes (mirrored in client/src/api/mobility.ts)
// ---------------------------------------------------------------------------

export interface RoutineFull extends MobilityRoutine {
  items: MobilityRoutineItem[];
}

export interface MobilityHistoryPoint {
  date: string;
  /** sessions logged that day */
  sessions: number;
  totalMinutes: number;
}

export interface MetricTrend {
  metric: MobilityMetric;
  /** assessments in the window, oldest first (charting order) */
  assessments: MobilityAssessment[];
  stats: {
    count: number;
    first: number | null;
    latest: number | null;
    min: number | null;
    max: number | null;
    avg: number | null;
  };
  /** direction-aware first-vs-latest judgement; "steady" when under 2 points */
  trend: "improving" | "declining" | "steady";
}

// ---------------------------------------------------------------------------
// Stretch bank
// ---------------------------------------------------------------------------

export function listStretches(): Stretch[] {
  const rows = db
    .prepare("SELECT * FROM stretches ORDER BY name COLLATE NOCASE")
    .all() as any[];
  return rows.map(mapStretch);
}

export function getStretchById(id: number): Stretch | null {
  const row = db.prepare("SELECT * FROM stretches WHERE id = ?").get(id);
  return row ? mapStretch(row) : null;
}

function requireStretch(id: number): Stretch {
  const s = getStretchById(id);
  if (!s) throw new NotFoundError(`No stretch #${id}`);
  return s;
}

export function createStretch(input: any): Stretch {
  if (!input || typeof input.name !== "string" || !input.name.trim())
    throw new BadRequestError("name is required");
  const info = db
    .prepare(
      `INSERT INTO stretches (name, category, target_areas, instructions, default_hold_seconds, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      normCategory(input.category, "stretch"),
      optStr(input.targetAreas),
      optStr(input.instructions),
      posIntOrNull(input.defaultHoldSeconds, "defaultHoldSeconds"),
      optStr(input.notes),
    );
  return getStretchById(Number(info.lastInsertRowid))!;
}

export function updateStretch(id: number, patch: any): Stretch {
  const current = requireStretch(id);
  if (!patch || typeof patch !== "object") throw new BadRequestError("body must be an object");
  const name = normPatchName(patch.name, current.name);
  db.prepare(
    `UPDATE stretches SET name = ?, category = ?, target_areas = ?, instructions = ?,
       default_hold_seconds = ?, notes = ? WHERE id = ?`,
  ).run(
    name,
    patch.category !== undefined ? normCategory(patch.category, current.category) : current.category,
    patch.targetAreas !== undefined ? optStr(patch.targetAreas) : current.targetAreas,
    patch.instructions !== undefined ? optStr(patch.instructions) : current.instructions,
    patch.defaultHoldSeconds !== undefined
      ? posIntOrNull(patch.defaultHoldSeconds, "defaultHoldSeconds")
      : current.defaultHoldSeconds,
    patch.notes !== undefined ? optStr(patch.notes) : current.notes,
    id,
  );
  return getStretchById(id)!;
}

export function deleteStretch(id: number): void {
  requireStretch(id);
  db.prepare("DELETE FROM stretches WHERE id = ?").run(id); // cascades routine items
}

// ---------------------------------------------------------------------------
// Routines (with ordered items)
// ---------------------------------------------------------------------------

function routineItems(routineId: number): MobilityRoutineItem[] {
  return (
    db
      .prepare(
        `SELECT mri.*, s.name AS stretch_name FROM mobility_routine_items mri
         JOIN stretches s ON s.id = mri.stretch_id
         WHERE mri.routine_id = ? ORDER BY mri.order_index, mri.id`,
      )
      .all(routineId) as any[]
  ).map(mapRoutineItem);
}

export function getRoutineWithItems(id: number): RoutineFull {
  const row = db.prepare("SELECT * FROM mobility_routines WHERE id = ?").get(id);
  if (!row) throw new NotFoundError(`No routine #${id}`);
  return { ...mapRoutine(row), items: routineItems(id) };
}

export function listRoutines(includeArchived = false): RoutineFull[] {
  const rows = db
    .prepare(
      includeArchived
        ? "SELECT id FROM mobility_routines ORDER BY archived, name COLLATE NOCASE"
        : "SELECT id FROM mobility_routines WHERE archived = 0 ORDER BY name COLLATE NOCASE",
    )
    .all() as { id: number }[];
  return rows.map((r) => getRoutineWithItems(r.id));
}

interface NormalizedItem {
  stretchId: number;
  holdSeconds: number | null;
  reps: number | null;
  perSide: 0 | 1;
  notes: string;
}

/** Validate a nested items array; every stretchId must reference a real stretch. */
function normItems(items: unknown): NormalizedItem[] {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw new BadRequestError("items must be an array");
  return items.map((it: any, i) => {
    if (!it || typeof it !== "object")
      throw new BadRequestError(`items[${i}] must be an object`);
    const stretchId = parseId(it.stretchId, `items[${i}].stretchId`);
    requireStretch(stretchId);
    return {
      stretchId,
      holdSeconds: posIntOrNull(it.holdSeconds, `items[${i}].holdSeconds`),
      reps: posIntOrNull(it.reps, `items[${i}].reps`),
      perSide: norm01(it.perSide, `items[${i}].perSide`, 0),
      notes: optStr(it.notes),
    };
  });
}

function insertItems(routineId: number, items: NormalizedItem[]): void {
  const stmt = db.prepare(
    `INSERT INTO mobility_routine_items (routine_id, stretch_id, order_index, hold_seconds, reps, per_side, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  items.forEach((it, i) =>
    stmt.run(routineId, it.stretchId, i, it.holdSeconds, it.reps, it.perSide, it.notes),
  );
}

/** Create a routine and its ordered items (orderIndex = array position) in one transaction. */
export function createRoutine(input: any): RoutineFull {
  if (!input || typeof input.name !== "string" || !input.name.trim())
    throw new BadRequestError("name is required");
  const items = normItems(input.items);
  const routineId = db.transaction((): number => {
    const info = db
      .prepare("INSERT INTO mobility_routines (name, description, focus) VALUES (?, ?, ?)")
      .run(input.name.trim(), optStr(input.description), optStr(input.focus));
    const id = Number(info.lastInsertRowid);
    insertItems(id, items);
    return id;
  })();
  return getRoutineWithItems(routineId);
}

/** Partial update; when `items` is given, ALL items are replaced in one transaction. */
export function updateRoutine(id: number, patch: any): RoutineFull {
  const current = getRoutineWithItems(id);
  if (!patch || typeof patch !== "object") throw new BadRequestError("body must be an object");
  const name = normPatchName(patch.name, current.name);
  const items =
    patch.items !== undefined && patch.items !== null ? normItems(patch.items) : null;
  db.transaction(() => {
    db.prepare(
      "UPDATE mobility_routines SET name = ?, description = ?, focus = ?, archived = ? WHERE id = ?",
    ).run(
      name,
      patch.description !== undefined ? optStr(patch.description) : current.description,
      patch.focus !== undefined ? optStr(patch.focus) : current.focus,
      norm01(patch.archived, "archived", current.archived),
      id,
    );
    if (items !== null) {
      db.prepare("DELETE FROM mobility_routine_items WHERE routine_id = ?").run(id);
      insertItems(id, items);
    }
  })();
  return getRoutineWithItems(id);
}

export function deleteRoutine(id: number): void {
  const info = db.prepare("DELETE FROM mobility_routines WHERE id = ?").run(id); // cascades items
  if (!info.changes) throw new NotFoundError(`No routine #${id}`);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function getSessionById(id: number): MobilitySession | null {
  const row = db
    .prepare(
      `SELECT ms.*, mr.name AS routine_name FROM mobility_sessions ms
       LEFT JOIN mobility_routines mr ON mr.id = ms.routine_id WHERE ms.id = ?`,
    )
    .get(id);
  return row ? mapMobilitySession(row) : null;
}

function requireSession(id: number): MobilitySession {
  const s = getSessionById(id);
  if (!s) throw new NotFoundError(`No session #${id}`);
  return s;
}

/** routineId is optional (null ok) but must reference a real routine when given. */
function normRoutineId(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const id = parseId(v, "routineId");
  getRoutineWithItems(id); // throws NotFoundError if missing
  return id;
}

export function listSessions(days: number): MobilitySession[] {
  const rows = db
    .prepare(
      `SELECT ms.*, mr.name AS routine_name FROM mobility_sessions ms
       LEFT JOIN mobility_routines mr ON mr.id = ms.routine_id
       WHERE ms.date >= ? ORDER BY ms.date DESC, ms.id DESC`,
    )
    .all(daysAgoStr(days - 1)) as any[];
  return rows.map(mapMobilitySession);
}

export function createSession(input: any): MobilitySession {
  if (!input || typeof input !== "object") throw new BadRequestError("body must be an object");
  const info = db
    .prepare(
      `INSERT INTO mobility_sessions (date, kind, routine_id, duration_minutes, feel, report, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parseDate(input.date, todayStr()),
      normKind(input.kind, "stretch"),
      normRoutineId(input.routineId),
      normDuration(input.durationMinutes),
      normFeel(input.feel),
      optStr(input.report),
      optStr(input.notes),
    );
  return getSessionById(Number(info.lastInsertRowid))!;
}

export function updateSession(id: number, patch: any): MobilitySession {
  const current = requireSession(id);
  if (!patch || typeof patch !== "object") throw new BadRequestError("body must be an object");
  db.prepare(
    `UPDATE mobility_sessions SET date = ?, kind = ?, routine_id = ?, duration_minutes = ?,
       feel = ?, report = ?, notes = ? WHERE id = ?`,
  ).run(
    patch.date !== undefined ? parseDate(patch.date) : current.date,
    patch.kind !== undefined ? normKind(patch.kind, current.kind) : current.kind,
    patch.routineId !== undefined ? normRoutineId(patch.routineId) : current.routineId,
    patch.durationMinutes !== undefined
      ? normDuration(patch.durationMinutes)
      : current.durationMinutes,
    patch.feel !== undefined ? normFeel(patch.feel) : current.feel,
    patch.report !== undefined ? optStr(patch.report) : current.report,
    patch.notes !== undefined ? optStr(patch.notes) : current.notes,
    id,
  );
  return getSessionById(id)!;
}

export function deleteSession(id: number): void {
  requireSession(id);
  db.prepare("DELETE FROM mobility_sessions WHERE id = ?").run(id);
}

/** Per-day session count + total minutes, oldest -> newest, over the last N days. */
export function getSessionHistory(days: number): MobilityHistoryPoint[] {
  const stmt = db.prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(duration_minutes), 0) AS m FROM mobility_sessions WHERE date = ?",
  );
  return dateRange(daysAgoStr(days - 1), todayStr()).map((date) => {
    const r = stmt.get(date) as { c: number; m: number };
    return { date, sessions: r.c, totalMinutes: round1(r.m) };
  });
}

/**
 * Recent sessions carrying a non-empty qualitative report, newest first.
 * The agent reads these for qualitative analysis (tight areas, pain flags).
 */
export function getRecentSessionReports(limit = 10): MobilitySession[] {
  const n = Math.min(50, Math.max(1, Math.round(Number(limit) || 10)));
  const rows = db
    .prepare(
      `SELECT ms.*, mr.name AS routine_name FROM mobility_sessions ms
       LEFT JOIN mobility_routines mr ON mr.id = ms.routine_id
       WHERE TRIM(ms.report) <> '' ORDER BY ms.date DESC, ms.id DESC LIMIT ?`,
    )
    .all(n) as any[];
  return rows.map(mapMobilitySession);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function listMetrics(): MobilityMetric[] {
  const rows = db
    .prepare("SELECT * FROM mobility_metrics ORDER BY active DESC, name COLLATE NOCASE")
    .all() as any[];
  return rows.map(mapMetric);
}

export function getMetricById(id: number): MobilityMetric | null {
  const row = db.prepare("SELECT * FROM mobility_metrics WHERE id = ?").get(id);
  return row ? mapMetric(row) : null;
}

function requireMetric(id: number): MobilityMetric {
  const m = getMetricById(id);
  if (!m) throw new NotFoundError(`No metric #${id}`);
  return m;
}

export function createMetric(input: any): MobilityMetric {
  if (!input || typeof input.name !== "string" || !input.name.trim())
    throw new BadRequestError("name is required");
  const info = db
    .prepare("INSERT INTO mobility_metrics (name, description, direction) VALUES (?, ?, ?)")
    .run(
      input.name.trim(),
      optStr(input.description),
      normDirection(input.direction, "higher_better"),
    );
  return getMetricById(Number(info.lastInsertRowid))!;
}

export function updateMetric(id: number, patch: any): MobilityMetric {
  const current = requireMetric(id);
  if (!patch || typeof patch !== "object") throw new BadRequestError("body must be an object");
  const name = normPatchName(patch.name, current.name);
  db.prepare(
    "UPDATE mobility_metrics SET name = ?, description = ?, direction = ?, active = ? WHERE id = ?",
  ).run(
    name,
    patch.description !== undefined ? optStr(patch.description) : current.description,
    patch.direction !== undefined ? normDirection(patch.direction, current.direction) : current.direction,
    norm01(patch.active, "active", current.active),
    id,
  );
  return getMetricById(id)!;
}

export function deleteMetric(id: number): void {
  requireMetric(id);
  db.prepare("DELETE FROM mobility_metrics WHERE id = ?").run(id); // cascades assessments
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export function listAssessments(days: number, metricId?: number): MobilityAssessment[] {
  const start = daysAgoStr(days - 1);
  const rows =
    metricId !== undefined
      ? (db
          .prepare(
            `SELECT ma.*, mm.name AS metric_name FROM mobility_assessments ma
             JOIN mobility_metrics mm ON mm.id = ma.metric_id
             WHERE ma.date >= ? AND ma.metric_id = ? ORDER BY ma.date, ma.id`,
          )
          .all(start, metricId) as any[])
      : (db
          .prepare(
            `SELECT ma.*, mm.name AS metric_name FROM mobility_assessments ma
             JOIN mobility_metrics mm ON mm.id = ma.metric_id
             WHERE ma.date >= ? ORDER BY ma.date, ma.id`,
          )
          .all(start) as any[]);
  return rows.map(mapAssessment);
}

export function getAssessmentById(id: number): MobilityAssessment | null {
  const row = db
    .prepare(
      `SELECT ma.*, mm.name AS metric_name FROM mobility_assessments ma
       JOIN mobility_metrics mm ON mm.id = ma.metric_id WHERE ma.id = ?`,
    )
    .get(id);
  return row ? mapAssessment(row) : null;
}

export function createAssessment(input: any): MobilityAssessment {
  if (!input || typeof input !== "object") throw new BadRequestError("body must be an object");
  const metricId = parseId(input.metricId, "metricId");
  requireMetric(metricId);
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 10)
    throw new BadRequestError("score must be an integer between 1 and 10");
  const info = db
    .prepare("INSERT INTO mobility_assessments (date, metric_id, score, notes) VALUES (?, ?, ?, ?)")
    .run(parseDate(input.date, todayStr()), metricId, score, optStr(input.notes));
  return getAssessmentById(Number(info.lastInsertRowid))!;
}

export function deleteAssessment(id: number): void {
  const info = db.prepare("DELETE FROM mobility_assessments WHERE id = ?").run(id);
  if (!info.changes) throw new NotFoundError(`No assessment #${id}`);
}

// ---------------------------------------------------------------------------
// Metric trend analysis
// ---------------------------------------------------------------------------

/**
 * A metric's assessments over the last N days with summary stats and a
 * direction-aware trend judgement: for higher_better metrics a rising
 * first-vs-latest score is "improving"; for lower_better it's "declining"
 * (and vice versa). "steady" when the scores match or there are < 2 points.
 */
export function getMetricTrend(metricId: number, days = 90): MetricTrend {
  const metric = requireMetric(metricId);
  const clamped = Math.min(3650, Math.max(1, Math.round(Number(days) || 90)));
  const assessments = listAssessments(clamped, metricId);
  const scores = assessments.map((a) => a.score);
  const count = scores.length;
  const first = count > 0 ? scores[0] : null;
  const latest = count > 0 ? scores[count - 1] : null;
  const stats = {
    count,
    first,
    latest,
    min: count > 0 ? Math.min(...scores) : null,
    max: count > 0 ? Math.max(...scores) : null,
    avg: count > 0 ? round1(scores.reduce((a, s) => a + s, 0) / count) : null,
  };
  let trend: MetricTrend["trend"] = "steady";
  if (count >= 2 && first !== null && latest !== null && latest !== first) {
    const raisedIsGood = metric.direction === "higher_better";
    trend = (latest > first) === raisedIsGood ? "improving" : "declining";
  }
  return { metric, assessments, stats, trend };
}
