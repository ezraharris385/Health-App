/**
 * Dashboard routes: daily health score, score history, and a cross-segment
 * overview of today's key numbers. Everything here is read-only — writes
 * happen through the segment routes and agents.
 */
import { Router } from "express";
import { db, isValidDateStr, todayStr } from "../db";
import { getSettings } from "../settingsStore";
import { computeDailyScore, getScoreHistory } from "../score";
import {
  getNutritionSummary,
  getSleepForDate,
  getVitaminSummary,
  getWorkoutDaySummary,
} from "../summaries";
import type { DailyScore } from "../../shared/types";

export const dashboardRouter = Router();

const MAX_HISTORY_DAYS = 90;

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
      inProgress: s != null && s.wakeTime == null,
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
    weight: {
      latest: weightRow?.weight ?? null,
      date: weightRow?.date ?? null,
      unit: goals.weightUnit,
      goal: goals.weightGoal,
    },
    goalStatement: goals.goalStatement,
  };
}

// GET /api/dashboard/score?date=YYYY-MM-DD (defaults to today)
dashboardRouter.get("/score", (req, res) => {
  const raw = req.query.date;
  if (raw !== undefined && !isValidDateStr(raw)) {
    return res.status(400).json({ error: "date must be a YYYY-MM-DD string" });
  }
  const date = raw !== undefined ? raw : todayStr();
  res.json(computeDailyScore(date));
});

// GET /api/dashboard/history?days=N (default 30, capped at 90)
dashboardRouter.get("/history", (req, res) => {
  const raw = req.query.days;
  const days = raw === undefined ? 30 : Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    return res.status(400).json({ error: "days must be a positive integer" });
  }
  res.json(getScoreHistory(Math.min(days, MAX_HISTORY_DAYS)));
});

// GET /api/dashboard/overview — today's cross-segment key numbers
dashboardRouter.get("/overview", (_req, res) => {
  res.json(buildOverview(todayStr()));
});
