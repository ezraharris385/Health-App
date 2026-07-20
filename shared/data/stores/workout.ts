/**
 * Workout segment data-access layer: exercise library, weekly plans (days +
 * ordered exercises), lifting sessions with set logging, per-exercise
 * performance history, and cardio (runs/walks) with step estimation.
 *
 * Runs in both modes: server routes (server/routes/workout.ts) and the
 * in-browser local API (client/src/local/api/workout.ts) are thin glue over
 * these helpers, and the workout agent (shared/agents/defs/workout.ts)
 * imports them directly so routes and agent tools always agree.
 */
import { db, daysAgoStr, dateRange, isValidDateStr, todayStr } from "../db";
import { estimateSteps, getWorkoutDaySummary, mapCardio } from "../summaries";
import type {
  CardioSession,
  CardioType,
  Exercise,
  ExerciseTrackingType,
  PlanDay,
  PlanDayExercise,
  SessionSet,
  WorkoutPlan,
  WorkoutSession,
} from "../../types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const notFound = (what: string) => new HttpError(404, `${what} not found`);

// ---------------------------------------------------------------------------
// Row mappers (snake_case -> camelCase)
// ---------------------------------------------------------------------------

function mapExercise(r: any): Exercise {
  return {
    id: r.id,
    name: r.name,
    muscleGroups: r.muscle_groups,
    equipment: r.equipment,
    instructions: r.instructions,
    notes: r.notes,
    trackingType: (r.tracking_type ?? "weight_reps") as ExerciseTrackingType,
    intensityRec: r.intensity_rec ?? "",
    goalRec: r.goal_rec ?? "",
    createdAt: r.created_at,
  };
}

function mapPlan(r: any): WorkoutPlan {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    goal: r.goal,
    archived: r.archived,
    createdAt: r.created_at,
  };
}

function mapPlanDay(r: any): PlanDay {
  return {
    id: r.id,
    planId: r.plan_id,
    dayOfWeek: r.day_of_week,
    name: r.name,
    orderIndex: r.order_index,
  };
}

function mapPlanDayExercise(r: any): PlanDayExercise {
  return {
    id: r.id,
    planDayId: r.plan_day_id,
    exerciseId: r.exercise_id,
    orderIndex: r.order_index,
    sets: r.sets,
    reps: r.reps,
    targetWeight: r.target_weight,
    restSeconds: r.rest_seconds,
    targetSeconds: r.target_seconds ?? null,
    targetDistanceM: r.target_distance_m ?? null,
    targetCount: r.target_count ?? null,
    notes: r.notes,
    exerciseName: r.exercise_name,
  };
}

function mapSession(r: any): WorkoutSession {
  return {
    id: r.id,
    date: r.date,
    planDayId: r.plan_day_id,
    name: r.name,
    notes: r.notes,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

function mapSet(r: any): SessionSet {
  return {
    id: r.id,
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    setNumber: r.set_number,
    reps: r.reps,
    weight: r.weight,
    rpe: r.rpe,
    durationSeconds: r.duration_seconds,
    distanceM: r.distance_m ?? null,
    count: r.count ?? null,
    notes: r.notes,
    exerciseName: r.exercise_name,
  };
}

// ---------------------------------------------------------------------------
// Composite shapes (mirrored in client/src/api/workout.ts)
// ---------------------------------------------------------------------------

export interface PlanDayFull extends PlanDay {
  exercises: PlanDayExercise[];
}
export interface PlanFull extends WorkoutPlan {
  days: PlanDayFull[];
}
export interface SessionFull extends WorkoutSession {
  sets: SessionSet[];
}
export interface WeekDaySchedule {
  date: string;
  dayOfWeek: number;
  isToday: boolean;
  scheduled: {
    planDayId: number;
    planId: number;
    planName: string;
    dayName: string;
    exerciseCount: number;
  }[];
  sessions: { id: number; name: string; completedAt: string | null; setCount: number }[];
  cardio: CardioSession[];
}
export interface WeekSchedule {
  start: string;
  end: string;
  days: WeekDaySchedule[];
}
export interface PerformancePoint {
  date: string;
  sets: number;
  /** total volume = Σ reps × weight (0 for non weight_reps exercises) */
  volume: number;
  bestWeight: number | null;
  bestReps: number;
  /** the best set's timed work in seconds (e.g. plank holds), if any */
  bestDurationSeconds: number | null;
  /** the best set's distance in meters (distance-tracked work), if any */
  bestDistanceM: number | null;
  /** the best set's count (count-tracked work), if any */
  bestCount: number | null;
  /** e.g. "100×5", "BW×12", "60s", "1500 m", or "50" depending on tracking type */
  bestSet: string;
  /** Epley estimated 1RM from the best weighted set (weight_reps only) */
  est1RM: number | null;
}
export interface ExercisePerformance {
  exerciseId: number;
  exerciseName: string;
  points: PerformancePoint[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function reqName(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} is required`);
  return v.trim();
}

function optStr(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string") throw new Error("Expected a string value");
  return v;
}

function optNum(v: unknown, what: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number`);
  return n;
}

function reqNum(v: unknown, what: string, min?: number, max?: number): number {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) {
    throw new Error(`${what} must be a number`);
  }
  if (min !== undefined && n < min) throw new Error(`${what} must be >= ${min}`);
  if (max !== undefined && n > max) throw new Error(`${what} must be <= ${max}`);
  return n;
}

function normDayOfWeek(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error("dayOfWeek must be an integer 0 (Sunday) to 6 (Saturday), or null");
  }
  return n;
}

function normDate(v: unknown): string {
  if (v === undefined || v === null || v === "") return todayStr();
  if (!isValidDateStr(v)) throw new Error("date must be a YYYY-MM-DD string");
  return v;
}

/** Seconds of timed work per set (e.g. planks): integer 1..21600, or null. */
function normDurationSeconds(v: unknown): number | null {
  const n = optNum(v, "durationSeconds");
  if (n === null) return null;
  const seconds = Math.round(n);
  if (seconds < 1 || seconds > 21600) {
    throw new Error("durationSeconds must be between 1 and 21600");
  }
  return seconds;
}

/** Meters covered for a distance-tracked set/target: >= 0, or null. */
function normDistanceM(v: unknown, what = "distanceM"): number | null {
  const n = optNum(v, what);
  if (n === null) return null;
  if (n < 0) throw new Error(`${what} must be >= 0`);
  return Math.round(n * 100) / 100;
}

/** Plain count for a count-tracked set/target: integer >= 0, or null. */
function normCount(v: unknown, what = "count"): number | null {
  const n = optNum(v, what);
  if (n === null) return null;
  const c = Math.round(n);
  if (c < 0) throw new Error(`${what} must be an integer >= 0`);
  return c;
}

/** Target hold/work seconds for a plan-day exercise: integer 1..86400, or null. */
function normTargetSeconds(v: unknown): number | null {
  const n = optNum(v, "targetSeconds");
  if (n === null) return null;
  const s = Math.round(n);
  if (s < 1 || s > 86400) throw new Error("targetSeconds must be between 1 and 86400");
  return s;
}

/** Target weight for a plan-day exercise: >= 0, or null. */
function normTargetWeight(v: unknown): number | null {
  const n = optNum(v, "targetWeight");
  if (n === null) return null;
  if (n < 0) throw new Error("targetWeight must be >= 0");
  return n;
}

/** Rest between sets for a plan-day exercise: integer seconds >= 0, or null. */
function normRestSeconds(v: unknown): number | null {
  const n = optNum(v, "restSeconds");
  if (n === null) return null;
  const s = Math.round(n);
  if (s < 0) throw new Error("restSeconds must be >= 0");
  return s;
}

/** Explicit step count (stepsRun/stepsWalked/steps): integer >= 0, or null. */
function normSteps(v: unknown, what: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  return Math.round(reqNum(v, what, 0));
}

/**
 * A logged set must record actual work — a strictly positive measured value.
 * Kept loose enough for any tracking type (weighted/bodyweight reps, a timed
 * hold, a distance, or a plain count), but a value of 0 counts as no work: a
 * bare weight with no reps, or a 0 m / 0-count / 0-rep set, is the empty set
 * this guard rejects (weight only ever qualifies alongside reps or duration).
 */
function assertMeasured(
  m: {
    reps: number;
    weight: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
    count: number | null;
  },
  label = "set",
): void {
  if (
    m.reps > 0 ||
    (m.durationSeconds ?? 0) > 0 ||
    (m.distanceM ?? 0) > 0 ||
    (m.count ?? 0) > 0
  ) {
    return;
  }
  throw new Error(
    `${label}: a set must record real work — a positive reps, durationSeconds, distanceM, or count`,
  );
}

const TRACKING_TYPES: ExerciseTrackingType[] = [
  "weight_reps",
  "reps",
  "time",
  "distance",
  "count",
];

/** Validate a tracking type, defaulting to 'weight_reps' when absent. */
function normTrackingType(v: unknown): ExerciseTrackingType {
  if (v === undefined || v === null || v === "") return "weight_reps";
  if (typeof v !== "string" || !TRACKING_TYPES.includes(v as ExerciseTrackingType)) {
    throw new Error(`trackingType must be one of: ${TRACKING_TYPES.join(", ")}`);
  }
  return v as ExerciseTrackingType;
}

const CARDIO_TYPES: CardioType[] = [
  "run",
  "jog",
  "walk",
  "interval",
  "hiit",
  "cycling",
  "rowing",
  "elliptical",
  "other",
];

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export function listExercises(query?: string): Exercise[] {
  const rows = query?.trim()
    ? (db
        .prepare(
          "SELECT * FROM exercises WHERE name LIKE ? OR muscle_groups LIKE ? ORDER BY name",
        )
        .all(`%${query.trim()}%`, `%${query.trim()}%`) as any[])
    : (db.prepare("SELECT * FROM exercises ORDER BY name").all() as any[]);
  return rows.map(mapExercise);
}

export function getExercise(id: number): Exercise {
  const row = db.prepare("SELECT * FROM exercises WHERE id = ?").get(id);
  if (!row) throw notFound(`Exercise #${id}`);
  return mapExercise(row);
}

export function createExercise(input: {
  name: unknown;
  muscleGroups?: unknown;
  equipment?: unknown;
  instructions?: unknown;
  notes?: unknown;
  trackingType?: unknown;
  intensityRec?: unknown;
  goalRec?: unknown;
}): Exercise {
  const name = reqName(input.name, "Exercise name");
  const info = db
    .prepare(
      `INSERT INTO exercises
         (name, muscle_groups, equipment, instructions, notes, tracking_type, intensity_rec, goal_rec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      optStr(input.muscleGroups),
      optStr(input.equipment),
      optStr(input.instructions),
      optStr(input.notes),
      normTrackingType(input.trackingType),
      optStr(input.intensityRec),
      optStr(input.goalRec),
    );
  return getExercise(Number(info.lastInsertRowid));
}

export function updateExercise(
  id: number,
  patch: {
    name?: unknown;
    muscleGroups?: unknown;
    equipment?: unknown;
    instructions?: unknown;
    notes?: unknown;
    trackingType?: unknown;
    intensityRec?: unknown;
    goalRec?: unknown;
  },
): Exercise {
  const current = getExercise(id);
  db.prepare(
    `UPDATE exercises SET name = ?, muscle_groups = ?, equipment = ?, instructions = ?, notes = ?,
       tracking_type = ?, intensity_rec = ?, goal_rec = ? WHERE id = ?`,
  ).run(
    patch.name !== undefined ? reqName(patch.name, "Exercise name") : current.name,
    patch.muscleGroups !== undefined ? optStr(patch.muscleGroups) : current.muscleGroups,
    patch.equipment !== undefined ? optStr(patch.equipment) : current.equipment,
    patch.instructions !== undefined ? optStr(patch.instructions) : current.instructions,
    patch.notes !== undefined ? optStr(patch.notes) : current.notes,
    patch.trackingType !== undefined ? normTrackingType(patch.trackingType) : current.trackingType,
    patch.intensityRec !== undefined ? optStr(patch.intensityRec) : current.intensityRec,
    patch.goalRec !== undefined ? optStr(patch.goalRec) : current.goalRec,
    id,
  );
  return getExercise(id);
}

export function deleteExercise(id: number): void {
  const info = db.prepare("DELETE FROM exercises WHERE id = ?").run(id);
  if (!info.changes) throw notFound(`Exercise #${id}`);
}

/**
 * Resolve an exercise reference (id or name) to an id; creates the exercise
 * when a name is given that doesn't exist yet (case-insensitive match).
 */
export function resolveExerciseId(ref: {
  exerciseId?: unknown;
  exerciseName?: unknown;
  muscleGroups?: unknown;
  equipment?: unknown;
  instructions?: unknown;
  trackingType?: unknown;
  intensityRec?: unknown;
  goalRec?: unknown;
}): number {
  if (ref.exerciseId !== undefined && ref.exerciseId !== null) {
    const id = reqNum(ref.exerciseId, "exerciseId", 1);
    getExercise(id); // throws if missing
    return id;
  }
  const name = reqName(ref.exerciseName, "exerciseName (or exerciseId)");
  const existing = db
    .prepare("SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1")
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  return createExercise({
    name,
    muscleGroups: ref.muscleGroups,
    equipment: ref.equipment,
    instructions: ref.instructions,
    trackingType: ref.trackingType,
    intensityRec: ref.intensityRec,
    goalRec: ref.goalRec,
  }).id;
}

/**
 * Resolve an exercise reference (id or name) to an EXISTING id without ever
 * creating one — throws notFound when the id/name has no match. Use this on
 * read-only paths (e.g. performance queries) so a typo or novel name can't
 * silently pollute the library.
 */
export function resolveExistingExerciseId(ref: {
  exerciseId?: unknown;
  exerciseName?: unknown;
}): number {
  if (ref.exerciseId !== undefined && ref.exerciseId !== null) {
    const id = reqNum(ref.exerciseId, "exerciseId", 1);
    getExercise(id); // throws if missing
    return id;
  }
  const name = reqName(ref.exerciseName, "exerciseName (or exerciseId)");
  const existing = db
    .prepare("SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1")
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  throw notFound(`Exercise "${name}"`);
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function planDayExercises(planDayId: number): PlanDayExercise[] {
  return (
    db
      .prepare(
        `SELECT pde.*, e.name AS exercise_name FROM plan_day_exercises pde
         JOIN exercises e ON e.id = pde.exercise_id
         WHERE pde.plan_day_id = ? ORDER BY pde.order_index, pde.id`,
      )
      .all(planDayId) as any[]
  ).map(mapPlanDayExercise);
}

export function getPlanFull(id: number): PlanFull {
  const row = db.prepare("SELECT * FROM workout_plans WHERE id = ?").get(id);
  if (!row) throw notFound(`Plan #${id}`);
  const plan = mapPlan(row);
  const days = (
    db
      .prepare("SELECT * FROM plan_days WHERE plan_id = ? ORDER BY order_index, id")
      .all(id) as any[]
  ).map((d) => ({ ...mapPlanDay(d), exercises: planDayExercises(d.id) }));
  return { ...plan, days };
}

export function listPlans(includeArchived = false): PlanFull[] {
  const rows = db
    .prepare(
      includeArchived
        ? "SELECT id FROM workout_plans ORDER BY archived, created_at DESC"
        : "SELECT id FROM workout_plans WHERE archived = 0 ORDER BY created_at DESC",
    )
    .all() as { id: number }[];
  return rows.map((r) => getPlanFull(r.id));
}

export interface FullPlanInput {
  name: unknown;
  description?: unknown;
  goal?: unknown;
  days?: {
    name?: unknown;
    dayOfWeek?: unknown;
    exercises?: {
      exerciseId?: unknown;
      exerciseName?: unknown;
      muscleGroups?: unknown;
      equipment?: unknown;
      instructions?: unknown;
      trackingType?: unknown;
      intensityRec?: unknown;
      goalRec?: unknown;
      sets?: unknown;
      reps?: unknown;
      targetWeight?: unknown;
      restSeconds?: unknown;
      targetSeconds?: unknown;
      targetDistanceM?: unknown;
      targetCount?: unknown;
      notes?: unknown;
    }[];
  }[];
}

/** Create a plan, its scheduled days, and each day's ordered exercises in one transaction. */
export function createFullPlan(input: FullPlanInput): PlanFull {
  const name = reqName(input?.name, "Plan name");
  const days = Array.isArray(input.days) ? input.days : [];
  const planId = db.transaction((): number => {
    // created_at is written as LOCAL wall-clock time (not SQL's UTC default) so
    // the schedule filter in summaries.ts compares like-for-like local dates —
    // otherwise an evening-created plan wouldn't schedule until "tomorrow".
    const info = db
      .prepare("INSERT INTO workout_plans (name, description, goal, created_at) VALUES (?, ?, ?, ?)")
      .run(
        name,
        optStr(input.description),
        optStr(input.goal),
        `${todayStr()} ${new Date().toTimeString().slice(0, 8)}`,
      );
    const pid = Number(info.lastInsertRowid);
    days.forEach((day, di) => {
      const dayInfo = db
        .prepare(
          "INSERT INTO plan_days (plan_id, day_of_week, name, order_index) VALUES (?, ?, ?, ?)",
        )
        .run(pid, normDayOfWeek(day.dayOfWeek), optStr(day.name, `Day ${di + 1}`), di);
      const dayId = Number(dayInfo.lastInsertRowid);
      const exercises = Array.isArray(day.exercises) ? day.exercises : [];
      exercises.forEach((ex, ei) => {
        const exerciseId = resolveExerciseId(ex);
        db.prepare(
          `INSERT INTO plan_day_exercises
             (plan_day_id, exercise_id, order_index, sets, reps, target_weight, rest_seconds,
              target_seconds, target_distance_m, target_count, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          dayId,
          exerciseId,
          ei,
          ex.sets !== undefined ? reqNum(ex.sets, "sets", 1, 20) : 3,
          optStr(ex.reps, "8-12"),
          normTargetWeight(ex.targetWeight),
          normRestSeconds(ex.restSeconds),
          normTargetSeconds(ex.targetSeconds),
          normDistanceM(ex.targetDistanceM, "targetDistanceM"),
          normCount(ex.targetCount, "targetCount"),
          optStr(ex.notes),
        );
      });
    });
    return pid;
  })();
  return getPlanFull(planId);
}

export function updatePlan(
  id: number,
  patch: { name?: unknown; description?: unknown; goal?: unknown; archived?: unknown },
): PlanFull {
  const current = getPlanFull(id);
  let archived: 0 | 1;
  if (patch.archived === undefined) archived = current.archived ? 1 : 0;
  else if (patch.archived === true || patch.archived === 1) archived = 1;
  else if (patch.archived === false || patch.archived === 0) archived = 0;
  else throw new Error("archived must be a boolean or 0/1");
  db.prepare(
    "UPDATE workout_plans SET name = ?, description = ?, goal = ?, archived = ? WHERE id = ?",
  ).run(
    patch.name !== undefined ? reqName(patch.name, "Plan name") : current.name,
    patch.description !== undefined ? optStr(patch.description) : current.description,
    patch.goal !== undefined ? optStr(patch.goal) : current.goal,
    archived,
    id,
  );
  return getPlanFull(id);
}

export function deletePlan(id: number): void {
  const info = db.prepare("DELETE FROM workout_plans WHERE id = ?").run(id);
  if (!info.changes) throw notFound(`Plan #${id}`);
}

export function createPlanDay(
  planId: number,
  input: { name?: unknown; dayOfWeek?: unknown },
): PlanDayFull {
  getPlanFull(planId); // existence check
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(order_index), -1) AS m FROM plan_days WHERE plan_id = ?")
    .get(planId) as { m: number };
  const info = db
    .prepare("INSERT INTO plan_days (plan_id, day_of_week, name, order_index) VALUES (?, ?, ?, ?)")
    .run(planId, normDayOfWeek(input.dayOfWeek), optStr(input.name, "New day"), maxOrder.m + 1);
  const id = Number(info.lastInsertRowid);
  const row = db.prepare("SELECT * FROM plan_days WHERE id = ?").get(id);
  return { ...mapPlanDay(row), exercises: [] };
}

export function updatePlanDay(
  dayId: number,
  patch: { name?: unknown; dayOfWeek?: unknown; orderIndex?: unknown; exerciseOrder?: unknown },
): PlanDayFull {
  const row = db.prepare("SELECT * FROM plan_days WHERE id = ?").get(dayId) as any;
  if (!row) throw notFound(`Plan day #${dayId}`);
  db.prepare("UPDATE plan_days SET name = ?, day_of_week = ?, order_index = ? WHERE id = ?").run(
    patch.name !== undefined ? optStr(patch.name) : row.name,
    patch.dayOfWeek !== undefined ? normDayOfWeek(patch.dayOfWeek) : row.day_of_week,
    patch.orderIndex !== undefined ? reqNum(patch.orderIndex, "orderIndex", 0) : row.order_index,
    dayId,
  );
  if (patch.exerciseOrder !== undefined) {
    if (!Array.isArray(patch.exerciseOrder)) {
      throw new Error("exerciseOrder must be an array of plan-day-exercise ids");
    }
    const existing = planDayExercises(dayId).map((e) => e.id);
    const order = patch.exerciseOrder.map((v) => reqNum(v, "exerciseOrder id", 1));
    for (const oid of order) {
      if (!existing.includes(oid)) {
        throw new Error(`Plan-day-exercise #${oid} does not belong to day #${dayId}`);
      }
    }
    const stmt = db.prepare("UPDATE plan_day_exercises SET order_index = ? WHERE id = ?");
    db.transaction(() => {
      order.forEach((oid, i) => stmt.run(i, oid));
      // anything not mentioned keeps stable order after the reordered ones
      existing
        .filter((e) => !order.includes(e))
        .forEach((oid, i) => stmt.run(order.length + i, oid));
    })();
  }
  const updated = db.prepare("SELECT * FROM plan_days WHERE id = ?").get(dayId);
  return { ...mapPlanDay(updated), exercises: planDayExercises(dayId) };
}

export function deletePlanDay(dayId: number): void {
  const info = db.prepare("DELETE FROM plan_days WHERE id = ?").run(dayId);
  if (!info.changes) throw notFound(`Plan day #${dayId}`);
}

export function addPlanDayExercise(
  dayId: number,
  input: {
    exerciseId?: unknown;
    exerciseName?: unknown;
    muscleGroups?: unknown;
    instructions?: unknown;
    trackingType?: unknown;
    intensityRec?: unknown;
    goalRec?: unknown;
    sets?: unknown;
    reps?: unknown;
    targetWeight?: unknown;
    restSeconds?: unknown;
    targetSeconds?: unknown;
    targetDistanceM?: unknown;
    targetCount?: unknown;
    notes?: unknown;
  },
): PlanDayExercise {
  const day = db.prepare("SELECT id FROM plan_days WHERE id = ?").get(dayId);
  if (!day) throw notFound(`Plan day #${dayId}`);
  const exerciseId = resolveExerciseId(input);
  const maxOrder = db
    .prepare(
      "SELECT COALESCE(MAX(order_index), -1) AS m FROM plan_day_exercises WHERE plan_day_id = ?",
    )
    .get(dayId) as { m: number };
  const info = db
    .prepare(
      `INSERT INTO plan_day_exercises
         (plan_day_id, exercise_id, order_index, sets, reps, target_weight, rest_seconds,
          target_seconds, target_distance_m, target_count, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dayId,
      exerciseId,
      maxOrder.m + 1,
      input.sets !== undefined ? reqNum(input.sets, "sets", 1, 20) : 3,
      optStr(input.reps, "8-12"),
      normTargetWeight(input.targetWeight),
      normRestSeconds(input.restSeconds),
      normTargetSeconds(input.targetSeconds),
      normDistanceM(input.targetDistanceM, "targetDistanceM"),
      normCount(input.targetCount, "targetCount"),
      optStr(input.notes),
    );
  const row = db
    .prepare(
      `SELECT pde.*, e.name AS exercise_name FROM plan_day_exercises pde
       JOIN exercises e ON e.id = pde.exercise_id WHERE pde.id = ?`,
    )
    .get(Number(info.lastInsertRowid));
  return mapPlanDayExercise(row);
}

export function updatePlanDayExercise(
  id: number,
  patch: {
    sets?: unknown;
    reps?: unknown;
    targetWeight?: unknown;
    restSeconds?: unknown;
    targetSeconds?: unknown;
    targetDistanceM?: unknown;
    targetCount?: unknown;
    notes?: unknown;
  },
): PlanDayExercise {
  const row = db.prepare("SELECT * FROM plan_day_exercises WHERE id = ?").get(id) as any;
  if (!row) throw notFound(`Plan-day-exercise #${id}`);
  db.prepare(
    `UPDATE plan_day_exercises SET sets = ?, reps = ?, target_weight = ?, rest_seconds = ?,
       target_seconds = ?, target_distance_m = ?, target_count = ?, notes = ? WHERE id = ?`,
  ).run(
    patch.sets !== undefined ? reqNum(patch.sets, "sets", 1, 20) : row.sets,
    patch.reps !== undefined ? optStr(patch.reps) : row.reps,
    patch.targetWeight !== undefined ? normTargetWeight(patch.targetWeight) : row.target_weight,
    patch.restSeconds !== undefined ? normRestSeconds(patch.restSeconds) : row.rest_seconds,
    patch.targetSeconds !== undefined ? normTargetSeconds(patch.targetSeconds) : row.target_seconds,
    patch.targetDistanceM !== undefined
      ? normDistanceM(patch.targetDistanceM, "targetDistanceM")
      : row.target_distance_m,
    patch.targetCount !== undefined ? normCount(patch.targetCount, "targetCount") : row.target_count,
    patch.notes !== undefined ? optStr(patch.notes) : row.notes,
    id,
  );
  const updated = db
    .prepare(
      `SELECT pde.*, e.name AS exercise_name FROM plan_day_exercises pde
       JOIN exercises e ON e.id = pde.exercise_id WHERE pde.id = ?`,
    )
    .get(id);
  return mapPlanDayExercise(updated);
}

export function deletePlanDayExercise(id: number): void {
  const info = db.prepare("DELETE FROM plan_day_exercises WHERE id = ?").run(id);
  if (!info.changes) throw notFound(`Plan-day-exercise #${id}`);
}

// ---------------------------------------------------------------------------
// Sessions & sets
// ---------------------------------------------------------------------------

function sessionSets(sessionId: number): SessionSet[] {
  return (
    db
      .prepare(
        `SELECT ss.*, e.name AS exercise_name FROM session_sets ss
         JOIN exercises e ON e.id = ss.exercise_id
         WHERE ss.session_id = ? ORDER BY ss.id`,
      )
      .all(sessionId) as any[]
  ).map(mapSet);
}

export function getSessionFull(id: number): SessionFull {
  const row = db.prepare("SELECT * FROM workout_sessions WHERE id = ?").get(id);
  if (!row) throw notFound(`Session #${id}`);
  return { ...mapSession(row), sets: sessionSets(id) };
}

export function listSessions(opts: { days?: number; date?: string } = {}): SessionFull[] {
  let rows: { id: number }[];
  if (opts.date) {
    if (!isValidDateStr(opts.date)) throw new Error("date must be YYYY-MM-DD");
    rows = db
      .prepare("SELECT id FROM workout_sessions WHERE date = ? ORDER BY id DESC")
      .all(opts.date) as { id: number }[];
  } else {
    const days = Math.min(3650, Math.max(1, Math.round(opts.days ?? 30)));
    rows = db
      .prepare("SELECT id FROM workout_sessions WHERE date >= ? ORDER BY date DESC, id DESC")
      .all(daysAgoStr(days - 1)) as { id: number }[];
  }
  return rows.map((r) => getSessionFull(r.id));
}

export function createSession(input: {
  date?: unknown;
  planDayId?: unknown;
  name?: unknown;
  notes?: unknown;
}): SessionFull {
  const date = normDate(input.date);
  let planDayId: number | null = null;
  let defaultName = "Workout";
  if (input.planDayId !== undefined && input.planDayId !== null && input.planDayId !== "") {
    planDayId = reqNum(input.planDayId, "planDayId", 1);
    const dayRow = db
      .prepare(
        `SELECT pd.name AS day_name, wp.name AS plan_name FROM plan_days pd
         JOIN workout_plans wp ON wp.id = pd.plan_id WHERE pd.id = ?`,
      )
      .get(planDayId) as { day_name: string; plan_name: string } | undefined;
    if (!dayRow) throw notFound(`Plan day #${planDayId}`);
    defaultName = `${dayRow.plan_name} — ${dayRow.day_name}`;
  }
  const info = db
    .prepare(
      "INSERT INTO workout_sessions (date, plan_day_id, name, notes, started_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(date, planDayId, optStr(input.name).trim() || defaultName, optStr(input.notes), new Date().toISOString());
  return getSessionFull(Number(info.lastInsertRowid));
}

export interface FullSessionEntryInput {
  exerciseId?: unknown;
  exerciseName?: unknown;
  trackingType?: unknown;
  intensityRec?: unknown;
  goalRec?: unknown;
  /** identical sets to record for this exercise (1-20, default 1) */
  sets?: unknown;
  /** optional — a set only needs at least one measured field */
  reps?: unknown;
  weight?: unknown;
  rpe?: unknown;
  durationSeconds?: unknown;
  distanceM?: unknown;
  count?: unknown;
  notes?: unknown;
}

export interface FullSessionInput {
  date?: unknown;
  planDayId?: unknown;
  name?: unknown;
  notes?: unknown;
  entries: FullSessionEntryInput[];
}

/**
 * Record a complete, already-finished workout in one call: creates the session
 * (started_at = completed_at = now) and, per entry, `sets` identical set rows.
 * Entries list only what was actually performed — skipped template exercises
 * are simply absent. Everything is validated before any row is written; the
 * writes (including on-the-fly exercise creation by name) run in one
 * transaction.
 */
export function logFullSession(input: FullSessionInput): SessionFull {
  const date = normDate(input?.date);
  let planDayId: number | null = null;
  let defaultName = "Workout";
  if (input.planDayId !== undefined && input.planDayId !== null && input.planDayId !== "") {
    planDayId = reqNum(input.planDayId, "planDayId", 1);
    const dayRow = db
      .prepare(
        `SELECT pd.name AS day_name, wp.name AS plan_name FROM plan_days pd
         JOIN workout_plans wp ON wp.id = pd.plan_id WHERE pd.id = ?`,
      )
      .get(planDayId) as { day_name: string; plan_name: string } | undefined;
    if (!dayRow) throw notFound(`Plan day #${planDayId}`);
    defaultName = `${dayRow.plan_name} — ${dayRow.day_name}`;
  }
  const name = optStr(input.name).trim() || defaultName;
  const notes = optStr(input.notes);
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error("entries must be a non-empty array of performed exercises");
  }
  const prepared = input.entries.map((entry, i) => {
    const label = `entries[${i}]`;
    // Reference must resolve: an existing id, or a name (created on write).
    if (entry.exerciseId !== undefined && entry.exerciseId !== null) {
      getExercise(reqNum(entry.exerciseId, `${label}.exerciseId`, 1)); // throws if missing
    } else {
      reqName(entry.exerciseName, `${label}.exerciseName (or exerciseId)`);
    }
    const sets =
      entry.sets !== undefined && entry.sets !== null && entry.sets !== ""
        ? Math.round(reqNum(entry.sets, `${label}.sets`, 1, 20))
        : 1;
    const reps =
      entry.reps === undefined || entry.reps === null || entry.reps === ""
        ? 0
        : Math.round(reqNum(entry.reps, `${label}.reps`, 0, 1000));
    const weight = optNum(entry.weight, `${label}.weight`);
    if (weight !== null && weight < 0) throw new Error(`${label}.weight must be >= 0`);
    const rpe = optNum(entry.rpe, `${label}.rpe`);
    if (rpe !== null && (rpe < 1 || rpe > 10)) {
      throw new Error(`${label}.rpe must be between 1 and 10`);
    }
    const durationSeconds = normDurationSeconds(entry.durationSeconds);
    const distanceM = normDistanceM(entry.distanceM, `${label}.distanceM`);
    const count = normCount(entry.count, `${label}.count`);
    assertMeasured({ reps, weight, durationSeconds, distanceM, count }, label);
    return {
      entry,
      sets,
      reps,
      weight,
      rpe,
      durationSeconds,
      distanceM,
      count,
      notes: optStr(entry.notes),
    };
  });
  const sessionId = db.transaction((): number => {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        "INSERT INTO workout_sessions (date, plan_day_id, name, notes, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(date, planDayId, name, notes, now, now);
    const sid = Number(info.lastInsertRowid);
    const insertSet = db.prepare(
      "INSERT INTO session_sets (session_id, exercise_id, set_number, reps, weight, rpe, duration_seconds, distance_m, count, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const p of prepared) {
      const exerciseId = resolveExerciseId(p.entry);
      for (let setNumber = 1; setNumber <= p.sets; setNumber++) {
        insertSet.run(
          sid,
          exerciseId,
          setNumber,
          p.reps,
          p.weight,
          p.rpe,
          p.durationSeconds,
          p.distanceM,
          p.count,
          p.notes,
        );
      }
    }
    return sid;
  })();
  return getSessionFull(sessionId);
}

export function updateSession(
  id: number,
  patch: { name?: unknown; notes?: unknown; date?: unknown },
): SessionFull {
  const current = getSessionFull(id);
  db.prepare("UPDATE workout_sessions SET name = ?, notes = ?, date = ? WHERE id = ?").run(
    patch.name !== undefined ? reqName(patch.name, "Session name") : current.name,
    patch.notes !== undefined ? optStr(patch.notes) : current.notes,
    patch.date !== undefined ? normDate(patch.date) : current.date,
    id,
  );
  return getSessionFull(id);
}

export function completeSession(id: number): SessionFull {
  getSessionFull(id); // existence check
  db.prepare(
    "UPDATE workout_sessions SET completed_at = COALESCE(completed_at, ?) WHERE id = ?",
  ).run(new Date().toISOString(), id);
  return getSessionFull(id);
}

export function deleteSession(id: number): void {
  const info = db.prepare("DELETE FROM workout_sessions WHERE id = ?").run(id);
  if (!info.changes) throw notFound(`Session #${id}`);
}

export function addSet(
  sessionId: number,
  input: {
    exerciseId?: unknown;
    exerciseName?: unknown;
    setNumber?: unknown;
    reps?: unknown;
    weight?: unknown;
    rpe?: unknown;
    durationSeconds?: unknown;
    distanceM?: unknown;
    count?: unknown;
    notes?: unknown;
  },
): SessionSet {
  getSessionFull(sessionId); // existence check
  const exerciseId = resolveExerciseId(input);
  const reps =
    input.reps === undefined || input.reps === null || input.reps === ""
      ? 0
      : Math.round(reqNum(input.reps, "reps", 0, 1000));
  const weight = optNum(input.weight, "weight");
  if (weight !== null && weight < 0) throw new Error("weight must be >= 0");
  const rpe = optNum(input.rpe, "rpe");
  if (rpe !== null && (rpe < 1 || rpe > 10)) throw new Error("rpe must be between 1 and 10");
  const durationSeconds = normDurationSeconds(input.durationSeconds);
  const distanceM = normDistanceM(input.distanceM);
  const count = normCount(input.count);
  assertMeasured({ reps, weight, durationSeconds, distanceM, count });
  const setNumber =
    input.setNumber !== undefined
      ? reqNum(input.setNumber, "setNumber", 1)
      : ((
          db
            .prepare(
              "SELECT COUNT(*) AS c FROM session_sets WHERE session_id = ? AND exercise_id = ?",
            )
            .get(sessionId, exerciseId) as { c: number }
        ).c + 1);
  const info = db
    .prepare(
      "INSERT INTO session_sets (session_id, exercise_id, set_number, reps, weight, rpe, duration_seconds, distance_m, count, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      sessionId,
      exerciseId,
      setNumber,
      reps,
      weight,
      rpe,
      durationSeconds,
      distanceM,
      count,
      optStr(input.notes),
    );
  const row = db
    .prepare(
      `SELECT ss.*, e.name AS exercise_name FROM session_sets ss
       JOIN exercises e ON e.id = ss.exercise_id WHERE ss.id = ?`,
    )
    .get(Number(info.lastInsertRowid));
  return mapSet(row);
}

export function updateSet(
  id: number,
  patch: {
    reps?: unknown;
    weight?: unknown;
    rpe?: unknown;
    durationSeconds?: unknown;
    distanceM?: unknown;
    count?: unknown;
    notes?: unknown;
    setNumber?: unknown;
  },
): SessionSet {
  const row = db.prepare("SELECT * FROM session_sets WHERE id = ?").get(id) as any;
  if (!row) throw notFound(`Set #${id}`);
  const rpe = patch.rpe !== undefined ? optNum(patch.rpe, "rpe") : row.rpe;
  if (rpe !== null && (rpe < 1 || rpe > 10)) throw new Error("rpe must be between 1 and 10");
  const weight = patch.weight !== undefined ? optNum(patch.weight, "weight") : row.weight;
  if (weight !== null && weight < 0) throw new Error("weight must be >= 0");
  const reps =
    patch.reps !== undefined ? Math.round(reqNum(patch.reps, "reps", 0, 1000)) : row.reps;
  const durationSeconds =
    patch.durationSeconds !== undefined
      ? normDurationSeconds(patch.durationSeconds)
      : row.duration_seconds;
  const distanceM =
    patch.distanceM !== undefined ? normDistanceM(patch.distanceM) : row.distance_m ?? null;
  const count = patch.count !== undefined ? normCount(patch.count) : row.count ?? null;
  assertMeasured({ reps, weight, durationSeconds, distanceM, count });
  db.prepare(
    "UPDATE session_sets SET reps = ?, weight = ?, rpe = ?, duration_seconds = ?, distance_m = ?, count = ?, notes = ?, set_number = ? WHERE id = ?",
  ).run(
    reps,
    weight,
    rpe,
    durationSeconds,
    distanceM,
    count,
    patch.notes !== undefined ? optStr(patch.notes) : row.notes,
    patch.setNumber !== undefined ? reqNum(patch.setNumber, "setNumber", 1) : row.set_number,
    id,
  );
  const updated = db
    .prepare(
      `SELECT ss.*, e.name AS exercise_name FROM session_sets ss
       JOIN exercises e ON e.id = ss.exercise_id WHERE ss.id = ?`,
    )
    .get(id);
  return mapSet(updated);
}

export function deleteSet(id: number): void {
  const info = db.prepare("DELETE FROM session_sets WHERE id = ?").run(id);
  if (!info.changes) throw notFound(`Set #${id}`);
}

// ---------------------------------------------------------------------------
// Performance history
// ---------------------------------------------------------------------------

interface PerfSet {
  reps: number;
  weight: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  count: number | null;
}

/**
 * Pick the "best" set of a day for the exercise's tracking type. Volume and 1RM
 * are only meaningful for weight_reps; other types rank on their own measured
 * field so getPerformance never assumes a weight is present.
 */
function bestSetFor(tracking: ExerciseTrackingType, sets: PerfSet[]): PerfSet {
  let best = sets[0];
  for (const s of sets) {
    let better = false;
    switch (tracking) {
      case "reps":
        better = s.reps > best.reps;
        break;
      case "time":
        better = (s.durationSeconds ?? 0) > (best.durationSeconds ?? 0);
        break;
      case "distance":
        better = (s.distanceM ?? 0) > (best.distanceM ?? 0);
        break;
      case "count":
        better = (s.count ?? 0) > (best.count ?? 0);
        break;
      default: {
        // weight_reps: heaviest wins; ties break on reps, then timed work.
        const bw = best.weight ?? -1;
        const sw = s.weight ?? -1;
        better =
          sw > bw ||
          (sw === bw &&
            (s.reps > best.reps ||
              (s.reps === best.reps &&
                (s.durationSeconds ?? 0) > (best.durationSeconds ?? 0))));
      }
    }
    if (better) best = s;
  }
  return best;
}

function bestSetLabel(tracking: ExerciseTrackingType, best: PerfSet): string {
  switch (tracking) {
    case "reps":
      return `${best.reps} reps`;
    case "time":
      return best.durationSeconds !== null ? `${best.durationSeconds}s` : `${best.reps} reps`;
    case "distance":
      return best.distanceM !== null ? `${best.distanceM} m` : `${best.reps} reps`;
    case "count":
      return best.count !== null ? `${best.count}` : `${best.reps} reps`;
    default:
      return `${best.weight !== null ? best.weight : "BW"}×${
        best.reps === 0 && best.durationSeconds !== null ? `${best.durationSeconds}s` : best.reps
      }`;
  }
}

export function getPerformance(exerciseId: number, days = 180): ExercisePerformance {
  const exercise = getExercise(exerciseId);
  const tracking = exercise.trackingType;
  const clamped = Math.min(730, Math.max(7, Math.round(days)));
  const rows = db
    .prepare(
      `SELECT ss.reps, ss.weight, ss.duration_seconds, ss.distance_m, ss.count, ws.date
       FROM session_sets ss
       JOIN workout_sessions ws ON ws.id = ss.session_id
       WHERE ss.exercise_id = ? AND ws.date >= ?
       ORDER BY ws.date`,
    )
    .all(exerciseId, daysAgoStr(clamped - 1)) as {
    reps: number;
    weight: number | null;
    duration_seconds: number | null;
    distance_m: number | null;
    count: number | null;
    date: string;
  }[];

  const byDate = new Map<string, PerfSet[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push({
      reps: r.reps,
      weight: r.weight,
      durationSeconds: r.duration_seconds,
      distanceM: r.distance_m,
      count: r.count,
    });
    byDate.set(r.date, list);
  }

  const points: PerformancePoint[] = [...byDate.entries()].map(([date, sets]) => {
    // Volume (Σ reps × weight) and 1RM only apply to weight_reps tracking.
    let volume = 0;
    if (tracking === "weight_reps") {
      for (const s of sets) volume += s.reps * (s.weight ?? 0);
    }
    const best = bestSetFor(tracking, sets);
    const est1RM =
      tracking === "weight_reps" && best.weight !== null && best.reps > 0
        ? Math.round(best.weight * (1 + best.reps / 30) * 10) / 10
        : null;
    return {
      date,
      sets: sets.length,
      volume: Math.round(volume * 10) / 10,
      bestWeight: best.weight,
      bestReps: best.reps,
      bestDurationSeconds: best.durationSeconds,
      bestDistanceM: best.distanceM,
      bestCount: best.count,
      bestSet: bestSetLabel(tracking, best),
      est1RM,
    };
  });

  return { exerciseId, exerciseName: exercise.name, points };
}

// ---------------------------------------------------------------------------
// Cardio
// ---------------------------------------------------------------------------

export function listCardio(days = 90): CardioSession[] {
  const clamped = Math.min(730, Math.max(1, Math.round(days)));
  return (
    db
      .prepare("SELECT * FROM cardio_sessions WHERE date >= ? ORDER BY date DESC, id DESC")
      .all(daysAgoStr(clamped - 1)) as any[]
  ).map(mapCardio);
}

export function getCardio(id: number): CardioSession {
  const row = db.prepare("SELECT * FROM cardio_sessions WHERE id = ?").get(id);
  if (!row) throw notFound(`Cardio session #${id}`);
  return mapCardio(row);
}

/** Effective total steps: the manual override if set, otherwise the estimates. */
export function cardioTotalSteps(c: CardioSession): number {
  return c.steps ?? (c.estimatedStepsRun ?? 0) + (c.estimatedStepsWalked ?? 0);
}

/** Optional non-negative distance/duration that treats absent as 0. */
function optAmount(v: unknown, what: string, max: number): number {
  if (v === undefined || v === null || v === "") return 0;
  return reqNum(v, what, 0, max);
}

export function createCardio(input: {
  date?: unknown;
  type: unknown;
  activityLabel?: unknown;
  distanceKm?: unknown;
  durationMinutes?: unknown;
  intensity?: unknown;
  steps?: unknown;
  stepsRun?: unknown;
  stepsWalked?: unknown;
  report?: unknown;
  notes?: unknown;
}): CardioSession {
  const type = input.type as CardioType;
  if (!CARDIO_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${CARDIO_TYPES.join(", ")}`);
  }
  const date = normDate(input.date);
  // Distance & duration are both optional (0 allowed) so a steps-only or
  // duration-only (e.g. HIIT) session is valid.
  const distanceKm = optAmount(input.distanceKm, "distanceKm", 500);
  const durationMinutes = optAmount(input.durationMinutes, "durationMinutes", 1440);
  const intensity =
    input.intensity !== undefined && input.intensity !== null && input.intensity !== ""
      ? Math.round(reqNum(input.intensity, "intensity", 1, 10))
      : 5;
  let steps: number | null = null;
  if (input.steps !== undefined && input.steps !== null && input.steps !== "") {
    steps = Math.round(reqNum(input.steps, "steps", 0));
  }
  const stepsRun = normSteps(input.stepsRun, "stepsRun");
  const stepsWalked = normSteps(input.stepsWalked, "stepsWalked");
  // Explicit run/walk counts win; otherwise auto-estimate from distance for
  // footfall types (estimateSteps returns 0/0 for the others without throwing).
  const auto = estimateSteps(type, distanceKm);
  const estRun = stepsRun !== null ? stepsRun : auto.run;
  const estWalked = stepsWalked !== null ? stepsWalked : auto.walked;
  const anySteps = (steps ?? 0) > 0 || estRun > 0 || estWalked > 0;
  if (!(distanceKm > 0 || durationMinutes > 0 || anySteps)) {
    throw new Error(
      "a cardio session needs at least one of: distance, duration, steps, stepsRun, or stepsWalked",
    );
  }
  const info = db
    .prepare(
      `INSERT INTO cardio_sessions
         (date, type, activity_label, distance_km, duration_minutes, intensity, steps, estimated_steps_run, estimated_steps_walked, report, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      date,
      type,
      optStr(input.activityLabel),
      distanceKm,
      durationMinutes,
      intensity,
      steps,
      estRun,
      estWalked,
      optStr(input.report),
      optStr(input.notes),
    );
  return getCardio(Number(info.lastInsertRowid));
}

export function updateCardio(
  id: number,
  patch: {
    date?: unknown;
    type?: unknown;
    activityLabel?: unknown;
    distanceKm?: unknown;
    durationMinutes?: unknown;
    intensity?: unknown;
    steps?: unknown;
    stepsRun?: unknown;
    stepsWalked?: unknown;
    report?: unknown;
    notes?: unknown;
  },
): CardioSession {
  const current = getCardio(id);
  const type = patch.type !== undefined ? (patch.type as CardioType) : current.type;
  if (!CARDIO_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${CARDIO_TYPES.join(", ")}`);
  }
  const distanceKm =
    patch.distanceKm !== undefined
      ? optAmount(patch.distanceKm, "distanceKm", 500)
      : current.distanceKm;
  const durationMinutes =
    patch.durationMinutes !== undefined
      ? optAmount(patch.durationMinutes, "durationMinutes", 1440)
      : current.durationMinutes;
  // Mirror createCardio: an empty/null intensity is not a value to validate —
  // keep the current one (create defaults to 5) instead of throwing on "".
  const intensity =
    patch.intensity !== undefined && patch.intensity !== null && patch.intensity !== ""
      ? Math.round(reqNum(patch.intensity, "intensity", 1, 10))
      : current.intensity;
  // steps: undefined = keep, null/"" = clear the manual override, number = override
  let steps: number | null = current.steps;
  if (patch.steps !== undefined) {
    steps =
      patch.steps === null || patch.steps === ""
        ? null
        : Math.round(reqNum(patch.steps, "steps", 0));
  }
  // estimated_steps_run/walked: an explicit stepsRun/stepsWalked wins; else
  // re-estimate from distance when type/distance changed; else keep as-is so an
  // unrelated edit (e.g. attaching a report) doesn't wipe hand-entered counts.
  const auto = estimateSteps(type, distanceKm);
  const recompute = patch.type !== undefined || patch.distanceKm !== undefined;
  let estRun = current.estimatedStepsRun ?? 0;
  let estWalked = current.estimatedStepsWalked ?? 0;
  if (patch.stepsRun !== undefined) {
    estRun =
      patch.stepsRun === null || patch.stepsRun === ""
        ? auto.run
        : Math.round(reqNum(patch.stepsRun, "stepsRun", 0));
  } else if (recompute) {
    estRun = auto.run;
  }
  if (patch.stepsWalked !== undefined) {
    estWalked =
      patch.stepsWalked === null || patch.stepsWalked === ""
        ? auto.walked
        : Math.round(reqNum(patch.stepsWalked, "stepsWalked", 0));
  } else if (recompute) {
    estWalked = auto.walked;
  }
  const anySteps = (steps ?? 0) > 0 || estRun > 0 || estWalked > 0;
  if (!(distanceKm > 0 || durationMinutes > 0 || anySteps)) {
    throw new Error(
      "a cardio session needs at least one of: distance, duration, steps, stepsRun, or stepsWalked",
    );
  }
  db.prepare(
    `UPDATE cardio_sessions SET date = ?, type = ?, activity_label = ?, distance_km = ?, duration_minutes = ?,
       intensity = ?, steps = ?, estimated_steps_run = ?, estimated_steps_walked = ?, report = ?, notes = ?
     WHERE id = ?`,
  ).run(
    patch.date !== undefined ? normDate(patch.date) : current.date,
    type,
    patch.activityLabel !== undefined ? optStr(patch.activityLabel) : current.activityLabel,
    distanceKm,
    durationMinutes,
    intensity,
    steps,
    estRun,
    estWalked,
    patch.report !== undefined ? optStr(patch.report) : current.report,
    patch.notes !== undefined ? optStr(patch.notes) : current.notes,
    id,
  );
  return getCardio(id);
}

export function deleteCardio(id: number): void {
  const info = db.prepare("DELETE FROM cardio_sessions WHERE id = ?").run(id);
  if (!info.changes) throw notFound(`Cardio session #${id}`);
}

// ---------------------------------------------------------------------------
// Week schedule
// ---------------------------------------------------------------------------

export function getWeekSchedule(anchorDate?: string): WeekSchedule {
  const anchor = anchorDate ?? todayStr();
  if (!isValidDateStr(anchor)) throw new Error("date must be YYYY-MM-DD");
  const dow = new Date(`${anchor}T12:00:00`).getDay();
  const start = daysAgoStr(dow, anchor);
  const end = daysAgoStr(-6, start);
  const today = todayStr();
  const exCountStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM plan_day_exercises WHERE plan_day_id = ?",
  );
  const days: WeekDaySchedule[] = dateRange(start, end).map((date) => {
    const summary = getWorkoutDaySummary(date);
    return {
      date,
      dayOfWeek: new Date(`${date}T12:00:00`).getDay(),
      isToday: date === today,
      scheduled: summary.scheduledPlanDays.map((s) => ({
        planDayId: s.id,
        planId: s.planId,
        planName: s.planName,
        dayName: s.name,
        exerciseCount: (exCountStmt.get(s.id) as { c: number }).c,
      })),
      sessions: summary.sessions,
      cardio: summary.cardio,
    };
  });
  return { start, end, days };
}
