/**
 * Master agent ("Health Coordinator"): monitors all five segments, explains
 * the daily score, and coordinates the specialist agents on cross-segment
 * requests. Its own tools are strictly read-only — writes happen through the
 * specialists it consults.
 *
 * NOTE: consult_agent is injected by registry.ts — do NOT define it here.
 */
import type { AgentDef, ToolDef } from "../framework";
import { db, isValidDateStr, todayStr } from "../../data/db";
import { getSettings } from "../../data/settingsStore";
import { computeDailyScore, getScoreHistory } from "../../data/score";
import {
  getEnergyBalance,
  getMobilityDaySummary,
  getNutritionSummary,
  getSleepForDate,
  getSleepHistory,
  getVitaminSummary,
  getWorkoutDaySummary,
} from "../../data/summaries";
import type { SleepLog } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDate(input: unknown): string {
  if (input === undefined || input === null || input === "") return todayStr();
  if (!isValidDateStr(input)) {
    throw new Error(`Invalid date "${String(input)}" — use YYYY-MM-DD.`);
  }
  return input;
}

function clampDays(input: unknown, fallback: number, max: number): number {
  if (input === undefined || input === null) return fallback;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`days must be a positive integer (got ${String(input)}).`);
  }
  return Math.min(n, max);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function compactSleep(s: SleepLog) {
  return {
    date: s.date,
    bedTime: s.bedTime,
    wakeTime: s.wakeTime,
    durationHours: s.durationHours,
    quality: s.quality,
    inProgress: s.wakeTime == null,
    notes: s.notes || undefined,
  };
}

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------

const tools: ToolDef[] = [
  {
    name: "get_daily_score",
    description:
      "Get the daily health score (0-100) for a date, with the per-component scores (workout, nutrition, sleep, vitamins) and the human-readable breakdown explaining each number. Weights: workout 25%, nutrition 30% (includes water), sleep 25%, vitamins 20%. Defaults to today.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) => {
      return JSON.stringify(computeDailyScore(resolveDate(input?.date)));
    },
  },
  {
    name: "get_score_history",
    description:
      "Get daily health scores for the last N days (default 30, max 90) plus the 7-day and 30-day averages. Use this to spot trends and weak components over time. Breakdown text is omitted for compactness — call get_daily_score for a specific day's explanation.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (1-90, default 30)" },
      },
    },
    run: (input: { days?: number }) => {
      const h = getScoreHistory(clampDays(input?.days, 30, 90));
      return JSON.stringify({
        daily: h.daily.map((d) => ({
          date: d.date,
          total: d.total,
          workout: d.workout,
          nutrition: d.nutrition,
          sleep: d.sleep,
          vitamins: d.vitamins,
        })),
        weeklyAverage: h.weeklyAverage,
        monthlyAverage: h.monthlyAverage,
      });
    },
  },
  {
    name: "get_workout_summary",
    description:
      "Get a day's training summary: lifting sessions (with set counts and completion state), cardio sessions (type, distance, duration, intensity, steps, the user's own report), and which plan days are scheduled for that weekday. Defaults to today.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) => {
      const date = resolveDate(input?.date);
      const w = getWorkoutDaySummary(date);
      return JSON.stringify({
        date,
        sessions: w.sessions.map((s) => ({
          id: s.id,
          name: s.name,
          completed: s.completedAt != null,
          setCount: s.setCount,
        })),
        cardio: w.cardio.map((c) => ({
          type: c.type,
          distanceKm: c.distanceKm,
          durationMinutes: c.durationMinutes,
          intensity: c.intensity,
          steps: c.steps ?? (c.estimatedStepsRun ?? 0) + (c.estimatedStepsWalked ?? 0),
          report: c.report ? c.report.slice(0, 300) : undefined,
        })),
        scheduledPlanDays: w.scheduledPlanDays.map((d) => ({
          planName: d.planName,
          dayName: d.name,
        })),
      });
    },
  },
  {
    name: "get_nutrition_summary",
    description:
      "Get a day's nutrition summary: calorie/macro totals vs goals, per-meal totals, water intake vs goal, and the list of logged foods with servings. Defaults to today. Use it to compute remaining calories/macros before consulting the nutrition specialist.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) => {
      const date = resolveDate(input?.date);
      const n = getNutritionSummary(date);
      const g = n.goals;
      return JSON.stringify({
        date,
        totals: n.totals,
        goals: {
          calorieGoal: g.calorieGoal,
          proteinGoalG: g.proteinGoalG,
          carbsGoalG: g.carbsGoalG,
          fatGoalG: g.fatGoalG,
          waterGoalMl: g.waterGoalMl,
        },
        remaining: {
          calories: Math.round(g.calorieGoal - n.totals.calories),
          proteinG: r1(g.proteinGoalG - n.totals.proteinG),
          carbsG: r1(g.carbsGoalG - n.totals.carbsG),
          fatG: r1(g.fatGoalG - n.totals.fatG),
        },
        waterMl: n.waterMl,
        byMeal: n.byMeal,
        logs: n.logs.map((l) => ({
          meal: l.meal,
          food: l.food?.name ?? `food #${l.foodId}`,
          servings: l.servings,
          calories: Math.round((l.food?.calories ?? 0) * l.servings),
          proteinG: r1((l.food?.proteinG ?? 0) * l.servings),
        })),
      });
    },
  },
  {
    name: "get_energy_balance",
    description:
      "Get a day's caloric balance ('energy'): body profile (age, height, weight, activity level), the Mifflin-St Jeor BMR and TDEE baseline, calorie intake, estimated exercise burn (cardio + strength), total burn, and net = intake − total burn (negative = deficit). status is deficit/surplus/even, or null until age, height, and a logged weight all exist (hasProfile). Defaults to today. Read-only — profile edits happen in Settings.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) => {
      const e = getEnergyBalance(resolveDate(input?.date));
      return JSON.stringify({
        date: e.date,
        hasProfile: e.hasProfile,
        weightLb: e.weightLb,
        activityLevel: e.activityLevel,
        bmr: e.bmr == null ? null : Math.round(e.bmr),
        tdee: e.tdee == null ? null : Math.round(e.tdee),
        intakeCalories: Math.round(e.intakeCalories),
        baselineBurn: e.baselineBurn == null ? null : Math.round(e.baselineBurn),
        exerciseBurn: Math.round(e.exerciseBurn),
        totalBurn: Math.round(e.totalBurn),
        net: e.net == null ? null : Math.round(e.net),
        status: e.status,
      });
    },
  },
  {
    name: "get_vitamin_summary",
    description:
      "Get a day's micronutrient coverage: percent of target per tracked nutrient with food vs supplement split, plus which supplements were taken and which are active. Defaults to today. Sort by percent yourself to find the biggest gaps.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) => {
      const date = resolveDate(input?.date);
      const v = getVitaminSummary(date);
      const avg =
        v.coverage.length === 0
          ? 0
          : Math.round(v.coverage.reduce((a, c) => a + c.percent, 0) / v.coverage.length);
      return JSON.stringify({
        date,
        averageCoveragePercent: avg,
        coverage: v.coverage.map((c) => ({
          nutrient: c.label,
          percent: c.percent,
          consumed: c.consumed,
          target: c.target,
          unit: c.unit,
          fromFood: c.fromFood,
          fromSupplements: c.fromSupplements,
        })),
        supplementsTaken: v.supplementsTaken.map((s) => s.supplementName ?? `#${s.supplementId}`),
        activeSupplements: v.activeSupplements.map((s) => s.name),
      });
    },
  },
  {
    name: "get_mobility_summary",
    description:
      "Get a day's stretching/yoga/posture summary: sessions (kind, duration, feel 1-5, the user's qualitative report), total minutes, any qualitative metric ratings logged that day, and the latest score per tracked metric (user-defined 1-10 scales like 'Hamstring flexibility' or 'Desk posture'). Defaults to today.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) => {
      const date = resolveDate(input?.date);
      const m = getMobilityDaySummary(date);
      return JSON.stringify({
        date,
        sessions: m.sessions.map((x) => ({
          kind: x.kind,
          routine: x.routineName ?? null,
          durationMinutes: x.durationMinutes,
          feel: x.feel,
          report: x.report ? x.report.slice(0, 300) : undefined,
        })),
        totalMinutes: m.totalMinutes,
        assessmentsToday: m.assessmentsToday.map((a) => ({
          metric: a.metricName,
          score: a.score,
          notes: a.notes || undefined,
        })),
        metricsLatest: m.metricsLatest,
      });
    },
  },
  {
    name: "get_sleep_summary",
    description:
      "Get sleep data. Pass a date (YYYY-MM-DD, the wake date) for one night, or pass days (default 7, max 90) for recent history with stats: average duration, average quality, and nights logged. Omit both for the last 7 days.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Wake date YYYY-MM-DD for a single night" },
        days: { type: "number", description: "How many recent days (1-90, default 7)" },
      },
    },
    run: (input: { date?: string; days?: number }) => {
      if (input?.date !== undefined && input.date !== null && input.date !== "") {
        if (!isValidDateStr(input.date)) {
          throw new Error(`Invalid date "${String(input.date)}" — use YYYY-MM-DD.`);
        }
        const s = getSleepForDate(input.date);
        return JSON.stringify(
          s ? compactSleep(s) : { date: input.date, logged: false },
        );
      }
      const days = clampDays(input?.days, 7, 90);
      const logs = getSleepHistory(days);
      const completed = logs.filter((l) => l.durationHours != null);
      const rated = logs.filter((l) => l.quality != null);
      const avgDurationHours =
        completed.length === 0
          ? null
          : r1(completed.reduce((a, l) => a + (l.durationHours ?? 0), 0) / completed.length);
      const avgQuality =
        rated.length === 0
          ? null
          : r1(rated.reduce((a, l) => a + (l.quality ?? 0), 0) / rated.length);
      return JSON.stringify({
        days,
        targetHours: getSettings().goals.sleepTargetHours,
        nightsLogged: completed.length,
        avgDurationHours,
        avgQuality,
        nights: logs.map(compactSleep),
      });
    },
  },
  {
    name: "get_settings",
    description:
      "Get the user's profile (name, age, height, sex, activity level, notes) and daily goals (calories, macros, water, sleep target, weight goal + unit, overall goal statement) plus any per-nutrient target overrides.",
    input_schema: { type: "object", properties: {} },
    run: () => JSON.stringify(getSettings()),
  },
];

// ---------------------------------------------------------------------------
// Context snapshot (today, compact — the model sees this every turn)
// ---------------------------------------------------------------------------

function buildContext(): string {
  const date = todayStr();
  const goals = getSettings().goals;
  const score = computeDailyScore(date);
  const n = getNutritionSummary(date);
  const s = getSleepForDate(date);
  const w = getWorkoutDaySummary(date);
  const v = getVitaminSummary(date);
  const avgCoverage =
    v.coverage.length === 0
      ? 0
      : Math.round(v.coverage.reduce((a, c) => a + c.percent, 0) / v.coverage.length);
  const lowestNutrients = [...v.coverage]
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 3)
    .map((c) => `${c.label} ${c.percent}%`);
  const weightRow = db
    .prepare("SELECT date, weight FROM weight_logs ORDER BY date DESC LIMIT 1")
    .get() as { date: string; weight: number } | undefined;
  const energy = getEnergyBalance(date);

  return JSON.stringify({
    today: date,
    score: {
      total: score.total,
      workout: score.workout,
      nutrition: score.nutrition,
      sleep: score.sleep,
      vitamins: score.vitamins,
    },
    breakdown: score.breakdown,
    nutrition: {
      calories: Math.round(n.totals.calories),
      calorieGoal: goals.calorieGoal,
      proteinG: Math.round(n.totals.proteinG),
      proteinGoalG: goals.proteinGoalG,
      waterMl: Math.round(n.waterMl),
      waterGoalMl: goals.waterGoalMl,
      itemsLogged: n.logs.length,
    },
    sleep: s
      ? { durationHours: s.durationHours, quality: s.quality, inProgress: s.wakeTime == null }
      : null,
    workout: {
      status:
        w.sessions.length > 0 || w.cardio.length > 0
          ? "trained"
          : w.scheduledPlanDays.length > 0
            ? "scheduled, not logged"
            : "rest day",
      liftingSessions: w.sessions.length,
      cardioSessions: w.cardio.length,
      scheduled: w.scheduledPlanDays.map((d) => `${d.planName}: ${d.name}`),
    },
    vitamins: { avgCoveragePercent: avgCoverage, lowest: lowestNutrients },
    energy: {
      hasProfile: energy.hasProfile,
      intakeCalories: Math.round(energy.intakeCalories),
      baselineTdee: energy.tdee == null ? null : Math.round(energy.tdee),
      exerciseBurn: Math.round(energy.exerciseBurn),
      totalBurn: Math.round(energy.totalBurn),
      net: energy.net == null ? null : Math.round(energy.net),
      status: energy.status,
    },
    latestWeight: weightRow
      ? { value: weightRow.weight, unit: goals.weightUnit, date: weightRow.date }
      : null,
    goalStatement: goals.goalStatement || null,
  });
}

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export const masterAgent: AgentDef = {
  name: "master",
  title: "Health Coordinator",
  persona: `You are the Health Coordinator — the master agent of a personal health-tracking app with five specialist segments, each run by its own agent: workout (lifting, weekly plans, cardio), nutrition (food log, calories/macros, water, weight), sleep, vitamins (micronutrient coverage and supplements), and mobility (stretching, yoga, posture — routines, session logs, and user-defined qualitative metrics rated 1-10 over time).

Every turn you receive an auto-injected <context> snapshot of today's live data plus your saved memory notes. Read both before answering; call your read tools when you need history or more detail than the snapshot carries.

Your job:
1. Daily combined analysis. Merge all five segments into one clear picture of the day. Lead with the daily score and what is driving it, then what to fix first.
2. Explain scores exactly. Use get_daily_score's breakdown — the total is a weighted mean: workout 22%, nutrition 28% (includes water), sleep 22%, vitamins 15%, mobility 13%. Quote the real numbers; never invent them.
3. Per-segment recommendations with concrete figures ("drink 900 ml more water", "dinner around 650 kcal with 45 g protein", "you're 40% short on magnesium").
   Energy / caloric balance: you also see a caloric-balance picture via get_energy_balance — baseline burn is the TDEE from the body profile (Mifflin-St Jeor BMR × activity multiplier), plus estimated exercise burn from logged cardio and lifting, all compared against calorie intake. Net = intake − (baseline TDEE + exercise); negative is a deficit, positive a surplus. It needs age, height, and a logged body weight to compute a baseline (hasProfile) — if any are missing, tell the user to add them in Settings and work from intake + exercise burn only. Exercise burn and strength burn are rough estimates; say so. Never invent a net when hasProfile is false.
4. Cross-segment coordination. For any request spanning segments — a meal that fits the remaining calories AND fills today's micronutrient gaps, adjusting food and training after a heavy meal, fixing bedtime to improve recovery — use the consult_agent tool to task the relevant specialists. Give each specialist a self-contained brief including every constraint you already know (remaining macros, deficient nutrients, tonight's schedule); consult several specialists, in parallel when their tasks are independent. The specialists have full live read access to their segment's data, but during a consultation they only ADVISE — they will not record anything unless your brief explicitly relays a direct user instruction (e.g. "the user asked to log 2 eggs at lunch"). Never turn your own recommendation into a write: recommending a supplement, meal, or plan must NEVER cause it to be created or marked taken/eaten/done — present the plan and let the user decide. If a specialist reports it modified data, tell the user exactly what changed. Then SYNTHESIZE the replies into one coherent, non-contradictory plan in your own words — never paste raw specialist output.

Your own tools are strictly read-only. When something must change, either route the action through a consulted specialist or give the user the exact steps.

Memory: save durable facts (goals, constraints, injuries, schedule patterns, decisions made) with save_memory, and keep notes current with update_memory / delete_memory.

Tone: a sharp, warm head coach. Dense, specific, real numbers, short sections. No filler, no generic wellness advice.`,
  tools,
  buildContext,
};
