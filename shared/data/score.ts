/**
 * Daily health score engine. Each component is 0-100; the total is a weighted
 * mean. Formulas are deliberately simple and documented so the master agent
 * (and the user) can explain any number.
 *
 * Weights: workout 25%, nutrition 30% (incl. water), sleep 25%, vitamins 20%.
 */
import { daysAgoStr, dateRange, todayStr } from "./db";
import { getSettings } from "./settingsStore";
import {
  getNutritionSummary,
  getSleepForDate,
  getVitaminSummary,
  getWorkoutDaySummary,
} from "./summaries";
import type { DailyScore, ScoreHistory } from "../types";

const WEIGHTS = { workout: 0.25, nutrition: 0.3, sleep: 0.25, vitamins: 0.2 };

export function computeDailyScore(date: string): DailyScore {
  const breakdown: Record<string, string> = {};
  const goals = getSettings().goals;

  // --- Workout: full credit for any completed training; scheduled-but-skipped
  // days are penalized; true rest days (nothing scheduled) score well.
  const w = getWorkoutDaySummary(date);
  const trained = w.sessions.length > 0 || w.cardio.length > 0;
  let workout: number;
  if (trained) {
    workout = 100;
    breakdown.workout = `Trained: ${w.sessions.length} lifting session(s), ${w.cardio.length} cardio session(s).`;
  } else if (w.scheduledPlanDays.length > 0) {
    workout = 25;
    breakdown.workout = `Scheduled workout (${w.scheduledPlanDays
      .map((d) => d.name)
      .join(", ")}) not logged.`;
  } else {
    workout = 85;
    breakdown.workout = "Rest day (nothing scheduled).";
  }

  // --- Nutrition: 70% food adherence + 30% water.
  const n = getNutritionSummary(date);
  let food = 0;
  if (n.logs.length === 0) {
    breakdown.nutrition = "No food logged.";
  } else {
    // Calories: 100 within ±10% of goal, sliding to 0 at ±50%.
    const calRatio = Math.abs(n.totals.calories - goals.calorieGoal) / goals.calorieGoal;
    const calScore = calRatio <= 0.1 ? 100 : Math.max(0, 100 - (calRatio - 0.1) * 250);
    // Protein: ratio to goal, capped at 100.
    const proteinScore = Math.min(100, (n.totals.proteinG / goals.proteinGoalG) * 100);
    food = 0.6 * calScore + 0.4 * proteinScore;
    breakdown.nutrition = `Calories ${Math.round(n.totals.calories)}/${goals.calorieGoal} (score ${Math.round(
      calScore,
    )}), protein ${Math.round(n.totals.proteinG)}g/${goals.proteinGoalG}g (score ${Math.round(proteinScore)}).`;
  }
  const waterScore = Math.min(100, (n.waterMl / goals.waterGoalMl) * 100);
  breakdown.water = `Water ${Math.round(n.waterMl)}ml/${goals.waterGoalMl}ml.`;
  const nutrition = 0.7 * food + 0.3 * waterScore;

  // --- Sleep: duration vs target; 100 at >= target, linear down to 0 at 50% target.
  const s = getSleepForDate(date);
  let sleep = 0;
  if (!s || s.durationHours == null) {
    breakdown.sleep = "No completed sleep logged.";
  } else {
    const ratio = s.durationHours / goals.sleepTargetHours;
    sleep = ratio >= 1 ? 100 : Math.max(0, ((ratio - 0.5) / 0.5) * 100);
    // Slight penalty for extreme oversleep (>125% of target)
    if (ratio > 1.25) sleep = 90;
    breakdown.sleep = `Slept ${s.durationHours}h vs ${goals.sleepTargetHours}h target.`;
  }

  // --- Vitamins: mean coverage percent across tracked nutrients.
  const v = getVitaminSummary(date);
  const vitamins =
    v.coverage.length === 0
      ? 0
      : v.coverage.reduce((acc, c) => acc + c.percent, 0) / v.coverage.length;
  breakdown.vitamins = `Average micronutrient coverage ${Math.round(vitamins)}% across ${v.coverage.length} tracked nutrients.`;

  const total =
    WEIGHTS.workout * workout +
    WEIGHTS.nutrition * nutrition +
    WEIGHTS.sleep * sleep +
    WEIGHTS.vitamins * vitamins;

  return {
    date,
    total: Math.round(total),
    workout: Math.round(workout),
    nutrition: Math.round(nutrition),
    sleep: Math.round(sleep),
    vitamins: Math.round(vitamins),
    breakdown,
  };
}

export function getScoreHistory(days: number): ScoreHistory {
  const end = todayStr();
  const start = daysAgoStr(days - 1);
  const daily = dateRange(start, end).map(computeDailyScore);
  const avg = (list: DailyScore[]) =>
    list.length === 0 ? 0 : Math.round(list.reduce((a, d) => a + d.total, 0) / list.length);
  const last7 = daily.slice(-7);
  const last30 = daily.slice(-30);
  return { daily, weeklyAverage: avg(last7), monthlyAverage: avg(last30) };
}
