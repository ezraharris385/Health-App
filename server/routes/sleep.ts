/**
 * Sleep segment routes.
 *
 * Flow: POST /bed opens a log (bed_time = now, one open log at a time);
 * POST /wake closes the open log and attributes the night to the WAKE date
 * (localDateStr semantics, computed server-side). Manual CRUD under /logs
 * covers forgotten nights. GET /history returns a day-aligned duration series
 * for charting; GET /stats aggregates averages, bedtime consistency/drift and
 * day-of-week patterns.
 *
 * The data helpers are exported so the sleep agent's tools
 * (server/agents/defs/sleep.ts) share the exact same validation and write
 * paths as the HTTP API.
 */
import { Router, type Request, type Response } from "express";
import { db, dateRange, daysAgoStr, localDateStr, todayStr } from "../db";
import { getSettings } from "../settingsStore";
import { mapSleep } from "../summaries";
import type { SleepLog } from "../../shared/types";

// ---------------------------------------------------------------------------
// Errors + validation helpers
// ---------------------------------------------------------------------------

export class SleepError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_SLEEP_HOURS = 24;

function parseDateTime(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SleepError(400, `${field} must be an ISO datetime string`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new SleepError(400, `${field} is not a valid datetime: ${value}`);
  }
  return d;
}

function validateWindow(bed: Date, wake: Date): void {
  const ms = wake.getTime() - bed.getTime();
  if (ms <= 0) throw new SleepError(400, "wakeTime must be after bedTime");
  if (ms > MAX_SLEEP_HOURS * 3_600_000) {
    throw new SleepError(400, `Sleep duration exceeds ${MAX_SLEEP_HOURS}h — check the dates`);
  }
}

function normalizeQuality(q: unknown): number | null {
  if (q === undefined || q === null || q === "") return null;
  const n = Number(q);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new SleepError(400, "quality must be an integer between 1 and 5");
  }
  return n;
}

function normalizeNotes(n: unknown): string {
  if (n === undefined || n === null) return "";
  if (typeof n !== "string") throw new SleepError(400, "notes must be a string");
  return n.trim();
}

function parseDays(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    throw new SleepError(400, "days must be a number between 1 and 3650");
  }
  return Math.floor(n);
}

// ---------------------------------------------------------------------------
// Data helpers (exported — reused by the sleep agent's tools)
// ---------------------------------------------------------------------------

export function getSleepLogById(id: number): SleepLog | null {
  const row = db.prepare("SELECT * FROM sleep_logs WHERE id = ?").get(id) as any;
  return row ? mapSleep(row) : null;
}

/** The currently-open log (wake_time IS NULL), if any. */
export function getOpenSleepLog(): SleepLog | null {
  const row = db
    .prepare("SELECT * FROM sleep_logs WHERE wake_time IS NULL ORDER BY id DESC LIMIT 1")
    .get() as any;
  return row ? mapSleep(row) : null;
}

/**
 * "Going to bed": open a new sleep log. `bedTime` defaults to now; a past
 * bedTime is allowed ("I actually turned in 20 minutes ago") but not a future
 * one. Rejects if a log is already open.
 */
export function startSleep(bedTime?: string): SleepLog {
  const open = getOpenSleepLog();
  if (open) {
    throw new SleepError(
      409,
      `A sleep log is already open (in bed since ${open.bedTime}). Wake up or delete it first.`,
    );
  }
  const bed = bedTime === undefined ? new Date() : parseDateTime(bedTime, "bedTime");
  if (bed.getTime() > Date.now() + 60_000) {
    throw new SleepError(400, "bedTime cannot be in the future");
  }
  // Provisional date = bed date; overwritten with the wake date on wake.
  const info = db
    .prepare("INSERT INTO sleep_logs (date, bed_time) VALUES (?, ?)")
    .run(localDateStr(bed), bed.toISOString());
  return getSleepLogById(Number(info.lastInsertRowid))!;
}

/**
 * "I'm awake": close the open log. The night is attributed to the wake date
 * (computed server-side with localDateStr). Optional quality/notes.
 */
export function wakeUp(
  opts: { wakeTime?: string; quality?: unknown; notes?: unknown } = {},
): SleepLog {
  const open = getOpenSleepLog();
  if (!open) {
    throw new SleepError(409, "No open sleep log — tap 'Going to bed' first, or add a manual entry.");
  }
  const wake = opts.wakeTime === undefined ? new Date() : parseDateTime(opts.wakeTime, "wakeTime");
  const bed = new Date(open.bedTime);
  validateWindow(bed, wake);
  const quality = opts.quality === undefined ? null : normalizeQuality(opts.quality);
  const notes = opts.notes === undefined ? "" : normalizeNotes(opts.notes);
  db.prepare("UPDATE sleep_logs SET wake_time = ?, date = ?, quality = ?, notes = ? WHERE id = ?").run(
    wake.toISOString(),
    localDateStr(wake),
    quality,
    notes,
    open.id,
  );
  return getSleepLogById(open.id)!;
}

/** Manual entry for a forgotten night. Date = wake date. */
export function createSleepLog(input: {
  bedTime: unknown;
  wakeTime: unknown;
  quality?: unknown;
  notes?: unknown;
}): SleepLog {
  const bed = parseDateTime(input.bedTime, "bedTime");
  const wake = parseDateTime(input.wakeTime, "wakeTime");
  validateWindow(bed, wake);
  const info = db
    .prepare("INSERT INTO sleep_logs (date, bed_time, wake_time, quality, notes) VALUES (?, ?, ?, ?, ?)")
    .run(
      localDateStr(wake),
      bed.toISOString(),
      wake.toISOString(),
      normalizeQuality(input.quality),
      normalizeNotes(input.notes),
    );
  return getSleepLogById(Number(info.lastInsertRowid))!;
}

/**
 * Edit a log. Only provided fields change; passing wakeTime on an open log
 * closes it. The attribution date is recomputed from the (new) wake time.
 */
export function updateSleepLog(
  id: number,
  patch: { bedTime?: unknown; wakeTime?: unknown; quality?: unknown; notes?: unknown },
): SleepLog {
  const existing = getSleepLogById(id);
  if (!existing) throw new SleepError(404, `No sleep log #${id}`);

  const bed = patch.bedTime === undefined ? new Date(existing.bedTime) : parseDateTime(patch.bedTime, "bedTime");
  const wake =
    patch.wakeTime === undefined
      ? existing.wakeTime
        ? new Date(existing.wakeTime)
        : null
      : parseDateTime(patch.wakeTime, "wakeTime");
  if (wake) validateWindow(bed, wake);

  const quality = patch.quality === undefined ? existing.quality : normalizeQuality(patch.quality);
  const notes = patch.notes === undefined ? existing.notes : normalizeNotes(patch.notes);
  const date = wake ? localDateStr(wake) : localDateStr(bed);

  db.prepare(
    "UPDATE sleep_logs SET date = ?, bed_time = ?, wake_time = ?, quality = ?, notes = ? WHERE id = ?",
  ).run(date, bed.toISOString(), wake ? wake.toISOString() : null, quality, notes, id);
  return getSleepLogById(id)!;
}

export function deleteSleepLog(id: number): void {
  const info = db.prepare("DELETE FROM sleep_logs WHERE id = ?").run(id);
  if (info.changes === 0) throw new SleepError(404, `No sleep log #${id}`);
}

/** Recent logs (window by attribution date), open log pinned first, newest first. */
export function getRecentSleepLogs(days: number): SleepLog[] {
  const start = daysAgoStr(days - 1);
  const rows = db
    .prepare(
      `SELECT * FROM sleep_logs WHERE date >= ? OR wake_time IS NULL
       ORDER BY (wake_time IS NULL) DESC, date DESC, id DESC`,
    )
    .all(start) as any[];
  return rows.map(mapSleep);
}

// ---------------------------------------------------------------------------
// History + stats
// ---------------------------------------------------------------------------

export interface SleepHistoryDay {
  date: string;
  hours: number | null;
  quality: number | null;
}

/** Day-aligned duration series (completed logs only; latest per date wins). */
export function getSleepHistoryDays(days: number): { days: SleepHistoryDay[]; targetHours: number } {
  const start = daysAgoStr(days - 1);
  const rows = db
    .prepare("SELECT * FROM sleep_logs WHERE date >= ? AND wake_time IS NOT NULL ORDER BY id")
    .all(start) as any[];
  const byDate = new Map<string, SleepLog>();
  for (const r of rows) byDate.set(r.date, mapSleep(r)); // later id overwrites
  const series = dateRange(start, todayStr()).map((date) => {
    const log = byDate.get(date);
    return { date, hours: log?.durationHours ?? null, quality: log?.quality ?? null };
  });
  return { days: series, targetHours: getSettings().goals.sleepTargetHours };
}

export interface SleepDayOfWeekStat {
  dow: number; // 0=Sun..6=Sat (of the wake date)
  label: string;
  avgHours: number | null;
  nights: number;
}

export interface SleepStats {
  days: number;
  nightsLogged: number;
  avgDurationHours: number | null;
  avgQuality: number | null;
  /** local clock time "HH:MM" (circular mean — handles crossing midnight) */
  avgBedTime: string | null;
  avgWakeTime: string | null;
  /** typical spread of bedtime around its mean, minutes (lower = more consistent) */
  bedtimeStdDevMinutes: number | null;
  /** signed shift of avg bedtime, last 7 days vs the 7 before (+ = later) */
  bedtimeDriftMinutes: number | null;
  targetHours: number;
  /** % of logged nights meeting the target duration */
  targetAdherencePct: number | null;
  byDayOfWeek: SleepDayOfWeekStat[];
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Shortest signed distance a→b around the 24h clock, in minutes (-720..720). */
function clockDiffMinutes(a: number, b: number): number {
  return ((a - b + 2160) % 1440) - 720;
}

function circularMeanMinutes(mins: number[]): number | null {
  if (mins.length === 0) return null;
  let sin = 0;
  let cos = 0;
  for (const m of mins) {
    const angle = (m / 1440) * 2 * Math.PI;
    sin += Math.sin(angle);
    cos += Math.cos(angle);
  }
  const mean = Math.atan2(sin / mins.length, cos / mins.length);
  return Math.round((((mean / (2 * Math.PI)) * 1440) % 1440 + 1440) % 1440);
}

function circularStdDevMinutes(mins: number[], meanMins: number): number | null {
  if (mins.length < 2) return null;
  const sumSq = mins.reduce((acc, m) => {
    const d = clockDiffMinutes(m, meanMins);
    return acc + d * d;
  }, 0);
  return Math.round(Math.sqrt(sumSq / mins.length));
}

function fmtHHMM(mins: number | null): string | null {
  if (mins == null) return null;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function computeSleepStats(days: number): SleepStats {
  const start = daysAgoStr(days - 1);
  const logs = (
    db
      .prepare("SELECT * FROM sleep_logs WHERE date >= ? AND wake_time IS NOT NULL ORDER BY date, id")
      .all(start) as any[]
  ).map(mapSleep);
  const targetHours = getSettings().goals.sleepTargetHours;
  const completed = logs.filter((l) => l.durationHours != null);

  const durations = completed.map((l) => l.durationHours!);
  const qualities = completed.map((l) => l.quality).filter((q): q is number => q != null);
  const bedMins = completed.map((l) => minutesOfDay(l.bedTime));
  const wakeMins = completed.map((l) => minutesOfDay(l.wakeTime!));

  const avgBedMins = circularMeanMinutes(bedMins);
  const avgWakeMins = circularMeanMinutes(wakeMins);

  // Bedtime drift: mean bedtime of the last 7 days vs the 7 days before that.
  const recentStart = daysAgoStr(6);
  const priorStart = daysAgoStr(13);
  const recentMean = circularMeanMinutes(
    completed.filter((l) => l.date >= recentStart).map((l) => minutesOfDay(l.bedTime)),
  );
  const priorMean = circularMeanMinutes(
    completed
      .filter((l) => l.date >= priorStart && l.date < recentStart)
      .map((l) => minutesOfDay(l.bedTime)),
  );
  const drift =
    recentMean != null && priorMean != null ? Math.round(clockDiffMinutes(recentMean, priorMean)) : null;

  const byDayOfWeek: SleepDayOfWeekStat[] = DOW_LABELS.map((label, dow) => {
    const nights = completed.filter((l) => new Date(`${l.date}T12:00:00`).getDay() === dow);
    return {
      dow,
      label,
      nights: nights.length,
      avgHours:
        nights.length === 0
          ? null
          : Math.round((nights.reduce((a, l) => a + l.durationHours!, 0) / nights.length) * 100) / 100,
    };
  });

  return {
    days,
    nightsLogged: completed.length,
    avgDurationHours:
      durations.length === 0
        ? null
        : Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100,
    avgQuality:
      qualities.length === 0
        ? null
        : Math.round((qualities.reduce((a, b) => a + b, 0) / qualities.length) * 10) / 10,
    avgBedTime: fmtHHMM(avgBedMins),
    avgWakeTime: fmtHHMM(avgWakeMins),
    bedtimeStdDevMinutes: avgBedMins == null ? null : circularStdDevMinutes(bedMins, avgBedMins),
    bedtimeDriftMinutes: drift,
    targetHours,
    targetAdherencePct:
      durations.length === 0
        ? null
        : Math.round((durations.filter((h) => h >= targetHours).length / durations.length) * 100),
    byDayOfWeek,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const sleepRouter = Router();

function respond(res: Response, fn: () => unknown, status = 200): void {
  try {
    res.status(status).json(fn());
  } catch (err) {
    if (err instanceof SleepError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("sleep route error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new SleepError(400, "Invalid id");
  return id;
}

sleepRouter.get("/state", (_req, res) => {
  respond(res, () => ({ open: getOpenSleepLog(), now: new Date().toISOString() }));
});

sleepRouter.post("/bed", (req, res) => {
  respond(res, () => startSleep(req.body?.bedTime), 201);
});

sleepRouter.post("/wake", (req, res) => {
  respond(res, () =>
    wakeUp({ wakeTime: req.body?.wakeTime, quality: req.body?.quality, notes: req.body?.notes }),
  );
});

sleepRouter.get("/logs", (req, res) => {
  respond(res, () => getRecentSleepLogs(parseDays(req.query.days, 30)));
});

sleepRouter.post("/logs", (req, res) => {
  respond(
    res,
    () =>
      createSleepLog({
        bedTime: req.body?.bedTime,
        wakeTime: req.body?.wakeTime,
        quality: req.body?.quality,
        notes: req.body?.notes,
      }),
    201,
  );
});

sleepRouter.put("/logs/:id", (req, res) => {
  respond(res, () =>
    updateSleepLog(idParam(req), {
      bedTime: req.body?.bedTime,
      wakeTime: req.body?.wakeTime,
      quality: req.body?.quality,
      notes: req.body?.notes,
    }),
  );
});

sleepRouter.delete("/logs/:id", (req, res) => {
  respond(res, () => {
    deleteSleepLog(idParam(req));
    return { ok: true };
  });
});

sleepRouter.get("/history", (req, res) => {
  respond(res, () => getSleepHistoryDays(parseDays(req.query.days, 30)));
});

sleepRouter.get("/stats", (req, res) => {
  respond(res, () => computeSleepStats(parseDays(req.query.days, 30)));
});
