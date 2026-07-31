/**
 * Daily health score engine. Each component is 0-100 and starts at 0 each day,
 * climbing as the user logs progress. The total is a weighted mean whose segment
 * weights are user-customizable (goal-based presets, see shared/data/scoreWeights.ts).
 * Formulas are deliberately simple and documented so the master agent (and the
 * user) can explain any number. The default "balanced" weights are workout 22,
 * nutrition 28 (incl. water), sleep 22, vitamins 15, mobility 13 — but never
 * assume them; DailyScore.weights carries the normalized percents actually used.
 */
import { daysAgoStr, dateRange, db, todayStr } from "./db";
import { getSettings } from "./settingsStore";
import { effectiveWeights } from "./scoreWeights";
import {
  getMobilityDaySummary,
  getNutritionSummary,
  getSleepForDate,
  getVitaminSummary,
  getWorkoutDaySummary,
} from "./summaries";
import type { DailyScore, ScoreHistory } from "../types";

export function computeDailyScore(date: string): DailyScore {
  const breakdown: Record<string, string> = {};
  const goals = getSettings().goals;

  // --- Workout: starts at 0, climbs with logged training. An "activity" is a
  // lifting session with real work (completed or ≥1 set) or any cardio session:
  // 1 activity = 70, 2 = 85, 3+ = 100.
  const w = getWorkoutDaySummary(date);
  const liftingCount = w.sessions.filter((s) => s.completedAt != null || s.setCount > 0).length;
  const cardioCount = w.cardio.length;
  const activities = liftingCount + cardioCount;
  let workout: number;
  if (activities === 0) {
    workout = 0;
    breakdown.workout = w.scheduledPlanDays.length
      ? "Scheduled training not logged yet — score climbs as you train."
      : "No training logged yet — score climbs as you train.";
  } else {
    workout = Math.min(100, 70 + 15 * (activities - 1));
    breakdown.workout = `${liftingCount} lifting session(s), ${cardioCount} cardio session(s).`;
  }

  // --- Nutrition: 70% food adherence + 30% water.
  const n = getNutritionSummary(date);
  let food = 0;
  if (n.logs.length === 0) {
    breakdown.nutrition = "No food logged.";
  } else {
    // Calories — date-aware. TODAY is an unfinished day and is never punished
    // for being under goal: while intake is at or below 110% of goal, score is
    // simply progress toward the goal (100 once within ~90% of it). FINISHED
    // days keep the original adherence band — 100 within ±10% of goal, sliding
    // to 0 at ±50% — so history is never silently re-scored by the mid-day
    // rule. Over-goal (>110%) both paths share the same slide: 100 at 110%,
    // reaching 0 at 150% of goal.
    let calScore: number;
    if (date === todayStr() && n.totals.calories <= goals.calorieGoal * 1.1) {
      calScore = Math.min(100, (n.totals.calories / (0.9 * goals.calorieGoal)) * 100);
    } else {
      const calRatio = Math.abs(n.totals.calories - goals.calorieGoal) / goals.calorieGoal;
      calScore = calRatio <= 0.1 ? 100 : Math.max(0, 100 - (calRatio - 0.1) * 250);
    }
    // Protein: ratio to goal, capped at 100.
    const proteinScore = Math.min(100, (n.totals.proteinG / goals.proteinGoalG) * 100);
    food = 0.6 * calScore + 0.4 * proteinScore;
    breakdown.nutrition = `Calories ${Math.round(n.totals.calories)}/${goals.calorieGoal} kcal, protein ${Math.round(
      n.totals.proteinG,
    )}/${goals.proteinGoalG} g.`;
  }
  const waterScore = Math.min(100, (n.waterMl / goals.waterGoalMl) * 100);
  // Imperial display: convert stored ml → fl oz (1 fl oz = 29.5735 ml).
  const flOz = (ml: number) => Math.round(ml / 29.5735);
  breakdown.water = `Water ${flOz(n.waterMl)}/${flOz(goals.waterGoalMl)} fl oz.`;
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

  // --- Mobility: starts at 0, climbs with logged minutes; 15+ min = 100.
  const m = getMobilityDaySummary(date);
  let mobility: number;
  if (m.sessions.length === 0) {
    mobility = 0;
    breakdown.mobility = "No mobility logged yet.";
  } else {
    mobility = Math.min(100, Math.round((100 * m.totalMinutes) / 15));
    breakdown.mobility = `${m.sessions.length} mobility session(s), ${m.totalMinutes} min total.`;
  }

  // Weighted total using the user's (normalized) segment weights.
  const frac = effectiveWeights(getSettings());
  const total =
    frac.workout * workout +
    frac.nutrition * nutrition +
    frac.sleep * sleep +
    frac.vitamins * vitamins +
    frac.mobility * mobility;
  const weights = {
    workout: Math.round(frac.workout * 100),
    nutrition: Math.round(frac.nutrition * 100),
    sleep: Math.round(frac.sleep * 100),
    vitamins: Math.round(frac.vitamins * 100),
    mobility: Math.round(frac.mobility * 100),
  };

  return {
    date,
    total: Math.round(total),
    workout: Math.round(workout),
    nutrition: Math.round(nutrition),
    sleep: Math.round(sleep),
    vitamins: Math.round(vitamins),
    mobility: Math.round(mobility),
    weights,
    breakdown,
  };
}

/**
 * Earliest date with any logged data across every log-bearing table, or null
 * when the database has no logs at all. MIN() ignores empty tables (NULL).
 */
function firstLoggedDate(): string | null {
  const row = db
    .prepare(
      `SELECT MIN(d) AS d FROM (
         SELECT MIN(date) AS d FROM food_logs
         UNION ALL SELECT MIN(date) FROM water_logs
         UNION ALL SELECT MIN(date) FROM workout_sessions
         UNION ALL SELECT MIN(date) FROM cardio_sessions
         UNION ALL SELECT MIN(date) FROM sleep_logs
         UNION ALL SELECT MIN(date) FROM mobility_sessions
         UNION ALL SELECT MIN(date) FROM supplement_logs
         UNION ALL SELECT MIN(date) FROM weight_logs
         UNION ALL SELECT MIN(date) FROM mobility_assessments
       )`,
    )
    .get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

export function getScoreHistory(days: number): ScoreHistory {
  const end = todayStr();
  const start = daysAgoStr(days - 1);
  const avg = (list: DailyScore[]) =>
    list.length === 0 ? 0 : Math.round(list.reduce((a, d) => a + d.total, 0) / list.length);

  const firstLogged = firstLoggedDate();
  if (firstLogged == null) {
    // No data anywhere: keep the original full-window behavior.
    const daily = dateRange(start, end).map(computeDailyScore);
    return { daily, weeklyAverage: avg(daily.slice(-7)), monthlyAverage: avg(daily.slice(-30)) };
  }

  // Trim the series so it never starts before the first day with any log (but
  // never widen past the requested window), and average only FINISHED days —
  // today is still in progress and pre-app days would drag averages to zero.
  const from = firstLogged > end ? end : firstLogged > start ? firstLogged : start;
  const daily = dateRange(from, end).map(computeDailyScore);
  const finished = daily.filter((d) => d.date !== end);
  return {
    daily,
    weeklyAverage: avg(finished.slice(-7)),
    monthlyAverage: avg(finished.slice(-30)),
  };
}
