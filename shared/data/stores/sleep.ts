/**
 * Sleep data store: one-tap bed/wake tracking, manual CRUD for forgotten
 * nights, day-aligned duration history, and aggregate stats (averages,
 * bedtime consistency/drift, day-of-week patterns).
 *
 * Flow: startSleep opens a log (bed_time = now, one open log at a time);
 * wakeUp closes the open log and attributes the night to the WAKE date
 * (localDateStr semantics). A date holds at most one completed log.
 *
 * Runtime-agnostic — runs in Node (server mode) and the browser (local mode)
 * through the injected DB handle. Consumed by the Express router
 * (server/routes/sleep.ts), the in-browser router
 * (client/src/local/api/sleep.ts), and the sleep agent
 * (shared/agents/defs/sleep.ts), so all three share the exact same
 * validation and write paths.
 */
import { db, dateRange, daysAgoStr, localDateStr, todayStr } from "../db";
import { getSettings } from "../settingsStore";
import { mapSleep } from "../summaries";
import type { SleepLog } from "../../types";

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

export function parseDays(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    throw new SleepError(400, "days must be a number between 1 and 3650");
  }
  return Math.floor(n);
}

/**
 * One completed log per wake date: history, day scoring and stats all treat a
 * date as a single night, so a second completed log would make them disagree.
 */
function assertNoCompletedLogForDate(date: string, excludeId?: number): void {
  const row = db
    .prepare("SELECT id FROM sleep_logs WHERE date = ? AND wake_time IS NOT NULL AND id != ?")
    .get(date, excludeId ?? -1) as any;
  if (row) {
    throw new SleepError(
      409,
      `A completed sleep log already exists for ${date} (#${row.id}) — edit or delete it instead`,
    );
  }
}

// ---------------------------------------------------------------------------
// Data helpers
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
 * (computed with localDateStr). Optional quality/notes.
 */
export function wakeUp(
  opts: { wakeTime?: string; quality?: unknown; notes?: unknown } = {},
): SleepLog {
  const open = getOpenSleepLog();
  if (!open) {
    throw new SleepError(409, "No open sleep log — tap 'Going to bed' first, or add a manual entry.");
  }
  const wake = opts.wakeTime === undefined ? new Date() : parseDateTime(opts.wakeTime, "wakeTime");
  if (wake.getTime() > Date.now() + 60_000) {
    throw new SleepError(400, "wakeTime cannot be in the future");
  }
  const bed = new Date(open.bedTime);
  validateWindow(bed, wake);
  assertNoCompletedLogForDate(localDateStr(wake), open.id);
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
  if (wake.getTime() > Date.now() + 60_000) {
    throw new SleepError(400, "wakeTime cannot be in the future");
  }
  validateWindow(bed, wake);
  assertNoCompletedLogForDate(localDateStr(wake));
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
  if (wake && wake.getTime() > Date.now() + 60_000) {
    throw new SleepError(400, "wakeTime cannot be in the future");
  }

  const quality = patch.quality === undefined ? existing.quality : normalizeQuality(patch.quality);
  const notes = patch.notes === undefined ? existing.notes : normalizeNotes(patch.notes);
  const date = wake ? localDateStr(wake) : localDateStr(bed);
  if (wake) assertNoCompletedLogForDate(date, id);

  db.prepare(
    "UPDATE sleep_logs SET date = ?, bed_time = ?, wake_time = ?, quality = ?, notes = ? WHERE id = ?",
  ).run(date, bed.toISOString(), wake ? wake.toISOString() : null, quality, notes, id);
  return getSleepLogById(id)!;
}

export function deleteSleepLog(id: number): void {
  const info = db.prepare("DELETE FROM sleep_logs WHERE id = ?").run(id);
  if (info.changes === 0) throw new SleepError(404, `No sleep log #${id}`);
}

/** The most recent completed log, regardless of how long ago it was. */
export function getLastCompletedSleepLog(): SleepLog | null {
  const row = db
    .prepare("SELECT * FROM sleep_logs WHERE wake_time IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1")
    .get() as any;
  return row ? mapSleep(row) : null;
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
