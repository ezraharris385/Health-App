/**
 * Dashboard data store: daily health score lookups, score history, and the
 * cross-segment overview of a day's key numbers. Everything here is
 * read-only — writes happen through the segment stores and agents.
 *
 * Runtime-agnostic — runs in Node (server mode) and the browser (local mode)
 * through the injected DB handle. Consumed by the Express router
 * (server/routes/dashboard.ts), the in-browser router
 * (client/src/local/api/dashboard.ts), and the master agent
 * (shared/agents/defs/master.ts), so all share the exact same validation and
 * read paths.
 */
import { db, isValidDateStr, todayStr } from "../db";
import { getSettings } from "../settingsStore";
import { computeDailyScore } from "../score";
import {
  getMobilityDaySummary,
  getNutritionSummary,
  getSleepForDate,
  getVitaminSummary,
  getWorkoutDaySummary,
} from "../summaries";
import { getOpenSleepLog } from "./sleep";
import type { DailyScore } from "../../types";

export class DashboardError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const MAX_HISTORY_DAYS = 90;

/**
 * Resolve the `date` query value for GET /api/dashboard/score: defaults to
 * today, rejects anything that isn't a YYYY-MM-DD string.
 */
export function parseScoreDate(raw: unknown): string {
  if (raw === undefined) return todayStr();
  if (!isValidDateStr(raw)) {
    throw new DashboardError(400, "date must be a YYYY-MM-DD string");
  }
  return raw;
}

/**
 * Resolve the `days` query value for GET /api/dashboard/history: default 30,
 * must be a positive integer, capped at MAX_HISTORY_DAYS.
 */
export function parseHistoryDays(raw: unknown): number {
  const days = raw === undefined ? 30 : Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new DashboardError(400, "days must be a positive integer");
  }
  return Math.min(days, MAX_HISTORY_DAYS);
}

/**
 * Cross-segment snapshot of one day (the tiles on the dashboard).
 * Mirrored in client/src/api/dashboard.ts — keep the two in sync.
 */
export interface DashboardOverview {
  date: string;
  score: DailyScore;
  workout: {
    status: "trained" | "scheduled" | "rest";
    sessionCount: number;
    completedSessionCount: number;
    setCount: number;
    cardioCount: number;
    cardioDistanceKm: number;
    /** "<plan>: <day name>" for each plan day scheduled on this weekday */
    scheduledPlanDays: string[];
  };
  nutrition: {
    calories: number;
    calorieGoal: number;
    proteinG: number;
    proteinGoalG: number;
    mealsLogged: number;
  };
  water: { totalMl: number; goalMl: number };
  sleep: {
    logged: boolean;
    /** true while a "going to bed" log is open (no wake time yet) */
    inProgress: boolean;
    durationHours: number | null;
    targetHours: number;
    quality: number | null;
  };
  vitamins: {
    averageCoveragePercent: number;
    nutrientsAtTarget: number;
    nutrientsTracked: number;
    supplementsTaken: number;
    activeSupplements: number;
  };
  mobility: {
    sessionCount: number;
    totalMinutes: number;
    kinds: string[];
    metricsTracked: number;
  };
  weight: {
    latest: number | null;
    date: string | null;
    unit: "lb" | "kg";
    goal: number | null;
  };
  goalStatement: string;
}

export function buildOverview(date: string): DashboardOverview {
  const settings = getSettings();
  const goals = settings.goals;
  const score = computeDailyScore(date);

  const w = getWorkoutDaySummary(date);
  const trained = w.sessions.length > 0 || w.cardio.length > 0;
  const workout: DashboardOverview["workout"] = {
    status: trained ? "trained" : w.scheduledPlanDays.length > 0 ? "scheduled" : "rest",
    sessionCount: w.sessions.length,
    completedSessionCount: w.sessions.filter((s) => s.completedAt != null).length,
    setCount: w.sessions.reduce((acc, s) => acc + s.setCount, 0),
    cardioCount: w.cardio.length,
    cardioDistanceKm:
      Math.round(w.cardio.reduce((acc, c) => acc + c.distanceKm, 0) * 100) / 100,
    scheduledPlanDays: w.scheduledPlanDays.map((d) =>
      d.name ? `${d.planName}: ${d.name}` : d.planName,
    ),
  };

  const n = getNutritionSummary(date);
  const s = getSleepForDate(date);
  const v = getVitaminSummary(date);
  const m = getMobilityDaySummary(date);
  const averageCoveragePercent =
    v.coverage.length === 0
      ? 0
      : Math.round(v.coverage.reduce((acc, c) => acc + c.percent, 0) / v.coverage.length);

  const weightRow = db
    .prepare("SELECT date, weight FROM weight_logs ORDER BY date DESC LIMIT 1")
    .get() as { date: string; weight: number } | undefined;

  return {
    date,
    score,
    workout,
    nutrition: {
      calories: Math.round(n.totals.calories),
      calorieGoal: goals.calorieGoal,
      proteinG: Math.round(n.totals.proteinG),
      proteinGoalG: goals.proteinGoalG,
      mealsLogged: n.logs.length,
    },
    water: { totalMl: Math.round(n.waterMl), goalMl: goals.waterGoalMl },
    sleep: {
      logged: s != null,
      // getSleepForDate only returns completed nights now; the in-progress flag
      // comes from the (single) open log, wherever its provisional date sits.
      inProgress: getOpenSleepLog() != null,
      durationHours: s?.durationHours ?? null,
      targetHours: goals.sleepTargetHours,
      quality: s?.quality ?? null,
    },
    vitamins: {
      averageCoveragePercent,
      nutrientsAtTarget: v.coverage.filter((c) => c.percent >= 100).length,
      nutrientsTracked: v.coverage.length,
      supplementsTaken: v.supplementsTaken.length,
      activeSupplements: v.activeSupplements.length,
    },
    mobility: {
      sessionCount: m.sessions.length,
      totalMinutes: m.totalMinutes,
      kinds: Object.keys(m.byKind),
      metricsTracked: m.metricsLatest.length,
    },
    weight: {
      latest: weightRow?.weight ?? null,
      date: weightRow?.date ?? null,
      unit: goals.weightUnit,
      goal: goals.weightGoal,
    },
    goalStatement: goals.goalStatement,
  };
}
