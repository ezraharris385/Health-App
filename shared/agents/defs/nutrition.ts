/**
 * Nutrition agent: evidence-based nutrition assistant with full read/write
 * access to the food library, food log, water log, weight log, and the
 * calorie/macro/water goals in settings.
 */
import type { AgentDef } from "../framework";
import { isValidDateStr, todayStr } from "../../data/db";
import { getSettings, saveSettings } from "../../data/settingsStore";
import { getNutritionSummary, getWaterMlForDate, getWeightHistory } from "../../data/summaries";
import { NUTRIENT_KEYS } from "../../nutrients";
import type { Food, UserGoals } from "../../types";
import {
  addWater,
  createFood,
  createFoodLog,
  deleteFoodLog,
  getFoodById,
  getMacroHistory,
  getWaterHistoryDays,
  listFoods,
  updateFood,
  upsertWeight,
} from "../../data/stores/nutrition";

const r1 = (n: number) => Math.round(n * 10) / 10;

function parseToolDate(v: unknown): string {
  if (v === undefined || v === null || v === "") return todayStr();
  if (!isValidDateStr(v)) throw new Error("date must be a YYYY-MM-DD string");
  return v;
}

function resolveFood(input: { foodId?: unknown; foodName?: unknown }): Food {
  if (input.foodId !== undefined && input.foodId !== null) {
    const id = Math.round(Number(input.foodId));
    if (!Number.isInteger(id) || id <= 0) throw new Error("foodId must be a positive integer");
    const food = getFoodById(id);
    if (!food) throw new Error(`No food #${id} — use search_foods to find the right id.`);
    return food;
  }
  const name = typeof input.foodName === "string" ? input.foodName.trim() : "";
  if (!name) throw new Error("Provide foodId or foodName");
  const matches = listFoods(name, 10);
  const exact = matches.filter((f) => f.name.toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return exact[0]!;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new Error(
      `No food in the library matches "${name}". Use search_foods to double-check, then create_food (filling macros AND micros from your knowledge) if it truly doesn't exist.`,
    );
  }
  throw new Error(
    `Ambiguous food name "${name}" — candidates: ${matches
      .map((f) => `#${f.id} ${f.name}${f.brand ? ` (${f.brand})` : ""}`)
      .join("; ")}. Call again with the foodId.`,
  );
}

function compactFood(f: Food) {
  return {
    id: f.id,
    name: f.name,
    brand: f.brand || undefined,
    serving: `${f.servingSize} ${f.servingUnit}`,
    calories: f.calories,
    proteinG: f.proteinG,
    carbsG: f.carbsG,
    fatG: f.fatG,
    fiberG: f.fiberG,
    sugarG: f.sugarG,
    sodiumMg: f.sodiumMg,
    microsFilled: Object.keys(f.micros).length,
    source: f.source,
  };
}

const MACRO_SCHEMA_PROPS = {
  servingSize: { type: "number", description: "Amount in one serving, e.g. 118" },
  servingUnit: { type: "string", description: "Unit of the serving, e.g. 'g', 'ml', 'item', 'cup'" },
  calories: { type: "number", description: "kcal per serving" },
  proteinG: { type: "number" },
  carbsG: { type: "number" },
  fatG: { type: "number" },
  fiberG: { type: "number" },
  sugarG: { type: "number" },
  sodiumMg: { type: "number" },
  micros: {
    type: "object",
    description: `Micronutrients per serving keyed by nutrient key. Valid keys: ${NUTRIENT_KEYS.filter((k) => k !== "fiber_g").join(", ")}. Put fiber in the fiberG field, not here. For common/public foods fill every micro you know a real value for.`,
    additionalProperties: { type: "number" },
  },
} as const;

export const nutritionAgent: AgentDef = {
  name: "nutrition",
  title: "Nutrition Assistant",
  persona: `You are the Nutrition Assistant in a personal health-tracking app. You own the food library, the per-meal daily food log, water tracking, the daily weight log, and the user's calorie/macro/water goals.

Every turn you receive two auto-injected inputs: your saved memory notes about the user, and a <context> snapshot of today's data (goals, consumed and remaining macros, water, meals logged, latest weight, profile). Use them before calling tools — the snapshot already answers most "where am I today?" questions; use get_daily_summary or get_history for other dates or details.

How to work:
- Read before you write. Always search_foods before create_food to avoid duplicates. When a common, publicly known item is missing (e.g. "banana", "Mountain Dew 12oz", "large egg"), create it yourself: fill serving size, calories, all macros AND every micronutrient you know a realistic value for (USDA-typical per-serving values), with source 'ai'. Never leave micros empty for foods that clearly contain them, and never invent values for obscure branded items — ask instead.
- When the user says they ate something, log it (log_food) with sensible servings and meal, then confirm briefly with concrete numbers ("Logged 2 x Large egg at breakfast — +143 kcal, 13g protein; 1,240 kcal remaining").
- When recommending what to eat, work from what is REMAINING today (goal minus consumed) and suggest specific foods and portions that fit the remaining calories and macros — favor protein when protein is behind.
- To set goals: derive calorie needs from the profile (Mifflin-St Jeor BMR x activity factor), adjust for the user's goal statement (roughly -500 kcal/day for ~1 lb/week loss, +250-500 for lean gain), set protein ~1.6-2.2 g/kg bodyweight, fat ~25-30% of calories, carbs the remainder. Show your math, confirm with the user, then persist with set_goals.
- Destructive changes (removing logs, overwriting goals) — confirm first unless the user was explicit.
- Save durable facts with memory tools: dietary preferences and restrictions, allergies, disliked foods, agreed goal targets and the reasoning, recurring eating patterns.

Tone: a genuinely helpful, evidence-based coach. Concrete numbers, specific foods, no filler, no moralizing about food choices.`,
  tools: [
    {
      name: "search_foods",
      description:
        "Search the food library by name or brand (case-insensitive substring). Returns per-serving macros and how many micronutrients are filled in. Call with no query to list the library. Always search before creating a food.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name/brand fragment, e.g. 'banana'" },
        },
      },
      run: (input: { query?: string }) => {
        const foods = listFoods(input?.query, 25);
        return JSON.stringify({
          count: foods.length,
          results: foods.map(compactFood),
          ...(foods.length === 0
            ? { hint: "No matches. If it's a common/public food, create it with create_food." }
            : {}),
        });
      },
    },
    {
      name: "create_food",
      description:
        "Create a food in the library. For common/public items (e.g. 'banana', 'Mountain Dew 12oz can', 'chicken breast 100g') fill calories, macros AND micronutrients from your own nutrition knowledge (USDA-typical values) — do not ask the user for label data — and it will be saved with source 'ai'. Amounts are per one serving.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Food name, e.g. 'Banana (medium)'" },
          brand: { type: "string", description: "Brand, if branded" },
          ...MACRO_SCHEMA_PROPS,
          source: {
            type: "string",
            enum: ["ai", "user"],
            description: "'ai' when you filled values from knowledge (default); 'user' when the user dictated label values",
          },
        },
        required: ["name", "servingSize", "servingUnit", "calories", "proteinG", "carbsG", "fatG"],
      },
      run: (input: any) => {
        const dupes = listFoods(String(input?.name ?? ""), 5).filter(
          (f) => f.name.toLowerCase() === String(input?.name ?? "").trim().toLowerCase(),
        );
        if (dupes.length > 0) {
          throw new Error(
            `A food named "${dupes[0]!.name}" already exists (#${dupes[0]!.id}). Use it, or update_food to correct it.`,
          );
        }
        const food = createFood(input, "ai");
        return JSON.stringify({ created: food });
      },
    },
    {
      name: "update_food",
      description:
        "Update an existing library food by id. Only the provided fields change. Use this to fix macros or fill in missing micronutrients on existing foods.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Food id (from search_foods)" },
          name: { type: "string" },
          brand: { type: "string" },
          ...MACRO_SCHEMA_PROPS,
          source: { type: "string", enum: ["ai", "user"] },
        },
        required: ["id"],
      },
      run: (input: any) => {
        const id = Math.round(Number(input?.id));
        if (!Number.isInteger(id) || id <= 0) throw new Error("id must be a positive integer");
        return JSON.stringify({ updated: updateFood(id, input) });
      },
    },
    {
      name: "log_food",
      description:
        "Log a food the user ate to a meal on a date (default today). Identify the food by foodId (preferred, from search_foods) or an exact foodName. Returns what was logged plus the day's updated calories.",
      input_schema: {
        type: "object",
        properties: {
          foodId: { type: "number" },
          foodName: { type: "string", description: "Exact library food name, if you don't have the id" },
          servings: { type: "number", description: "Number of servings, default 1" },
          meal: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
          date: { type: "string", description: "YYYY-MM-DD, default today" },
        },
        required: ["meal"],
      },
      run: (input: any) => {
        const food = resolveFood(input);
        const log = createFoodLog({
          date: parseToolDate(input?.date),
          foodId: food.id,
          servings: input?.servings,
          meal: input?.meal,
        });
        const s = getNutritionSummary(log.date);
        return JSON.stringify({
          logged: {
            logId: log.id,
            date: log.date,
            meal: log.meal,
            servings: log.servings,
            food: food.name,
            calories: r1(food.calories * log.servings),
            proteinG: r1(food.proteinG * log.servings),
          },
          dayTotals: s.totals,
          remaining: {
            calories: r1(s.goals.calorieGoal - s.totals.calories),
            proteinG: r1(s.goals.proteinGoalG - s.totals.proteinG),
          },
        });
      },
    },
    {
      name: "remove_food_log",
      description:
        "Remove a food log entry by its logId (get ids from get_daily_summary). Use when the user mislogged or wants an entry gone.",
      input_schema: {
        type: "object",
        properties: { logId: { type: "number" } },
        required: ["logId"],
      },
      run: (input: { logId: number }) => {
        const id = Math.round(Number(input?.logId));
        if (!Number.isInteger(id) || id <= 0) throw new Error("logId must be a positive integer");
        const removed = deleteFoodLog(id);
        return JSON.stringify({
          removed: {
            logId: removed.id,
            date: removed.date,
            meal: removed.meal,
            servings: removed.servings,
            food: removed.food?.name ?? `food #${removed.foodId}`,
          },
        });
      },
    },
    {
      name: "log_water",
      description:
        "Log water intake in ml for a date (default today). Returns the day's new total vs the water goal.",
      input_schema: {
        type: "object",
        properties: {
          amountMl: { type: "number", description: "Amount in ml, e.g. 500" },
          date: { type: "string", description: "YYYY-MM-DD, default today" },
        },
        required: ["amountMl"],
      },
      run: (input: { amountMl: number; date?: string }) => {
        const entry = addWater(input?.amountMl, parseToolDate(input?.date));
        const total = getWaterMlForDate(entry.date);
        const goal = getSettings().goals.waterGoalMl;
        return JSON.stringify({
          logged: entry,
          dayTotalMl: Math.round(total),
          goalMl: goal,
          remainingMl: Math.max(0, Math.round(goal - total)),
        });
      },
    },
    {
      name: "log_weight",
      description:
        "Record the user's body weight for a date (default today) in their configured unit. One entry per day — logging again overwrites that day's value.",
      input_schema: {
        type: "object",
        properties: {
          weight: { type: "number", description: "Weight in the user's unit (see context)" },
          date: { type: "string", description: "YYYY-MM-DD, default today" },
        },
        required: ["weight"],
      },
      run: (input: { weight: number; date?: string }) => {
        const entry = upsertWeight(input?.weight, parseToolDate(input?.date));
        const goals = getSettings().goals;
        return JSON.stringify({
          logged: entry,
          unit: goals.weightUnit,
          weightGoal: goals.weightGoal,
        });
      },
    },
    {
      name: "get_daily_summary",
      description:
        "Read the full nutrition summary for a date (default today): totals vs goals, remaining, per-meal breakdown, water, and every food log entry with its logId (needed for remove_food_log).",
      input_schema: {
        type: "object",
        properties: { date: { type: "string", description: "YYYY-MM-DD, default today" } },
      },
      run: (input: { date?: string }) => {
        const s = getNutritionSummary(parseToolDate(input?.date));
        const g = s.goals;
        return JSON.stringify({
          date: s.date,
          totals: s.totals,
          goals: {
            calorieGoal: g.calorieGoal,
            proteinGoalG: g.proteinGoalG,
            carbsGoalG: g.carbsGoalG,
            fatGoalG: g.fatGoalG,
            waterGoalMl: g.waterGoalMl,
          },
          remaining: {
            calories: r1(g.calorieGoal - s.totals.calories),
            proteinG: r1(g.proteinGoalG - s.totals.proteinG),
            carbsG: r1(g.carbsGoalG - s.totals.carbsG),
            fatG: r1(g.fatGoalG - s.totals.fatG),
          },
          byMealCalories: {
            breakfast: s.byMeal.breakfast.calories,
            lunch: s.byMeal.lunch.calories,
            dinner: s.byMeal.dinner.calories,
            snack: s.byMeal.snack.calories,
          },
          waterMl: Math.round(s.waterMl),
          logs: s.logs.map((l) => ({
            logId: l.id,
            meal: l.meal,
            food: l.food?.name ?? `food #${l.foodId}`,
            servings: l.servings,
            calories: r1((l.food?.calories ?? 0) * l.servings),
            proteinG: r1((l.food?.proteinG ?? 0) * l.servings),
          })),
        });
      },
    },
    {
      name: "get_history",
      description:
        "Read day-aligned history (including zero days) for trend analysis: daily calories/protein/carbs/fat, daily water totals, and weight entries. days defaults to 30, max 90.",
      input_schema: {
        type: "object",
        properties: { days: { type: "number", description: "How many days back, default 30, max 90" } },
      },
      run: (input: { days?: number }) => {
        const raw = input?.days === undefined ? 30 : Number(input.days);
        if (!Number.isFinite(raw)) throw new Error("days must be a number");
        const days = Math.min(90, Math.max(1, Math.round(raw)));
        return JSON.stringify({
          days,
          macroDays: getMacroHistory(days),
          waterDays: getWaterHistoryDays(days),
          weights: getWeightHistory(days),
        });
      },
    },
    {
      name: "set_goals",
      description:
        "Persist calorie/macro/water/weight goals to settings. Only the fields you pass change. Use after computing recommendations from the profile + goal statement and confirming with the user. Returns the saved goals.",
      input_schema: {
        type: "object",
        properties: {
          calorieGoal: { type: "number", description: "kcal/day" },
          proteinGoalG: { type: "number" },
          carbsGoalG: { type: "number" },
          fatGoalG: { type: "number" },
          waterGoalMl: { type: "number" },
          weightGoal: {
            type: ["number", "null"],
            description: "Target body weight in the user's unit; null clears it",
          },
          goalStatement: { type: "string", description: "Free-text overall goal" },
        },
      },
      run: (input: any) => {
        const patch: Partial<UserGoals> = {};
        const fields = [
          "calorieGoal",
          "proteinGoalG",
          "carbsGoalG",
          "fatGoalG",
          "waterGoalMl",
        ] as const;
        for (const f of fields) {
          if (input?.[f] !== undefined) {
            const n = Number(input[f]);
            if (!Number.isFinite(n) || n <= 0) throw new Error(`${f} must be a positive number`);
            patch[f] = Math.round(n);
          }
        }
        if (input?.weightGoal !== undefined) {
          if (input.weightGoal === null) {
            patch.weightGoal = null;
          } else {
            const n = Number(input.weightGoal);
            if (!Number.isFinite(n) || n <= 0) throw new Error("weightGoal must be a positive number or null");
            patch.weightGoal = r1(n);
          }
        }
        if (input?.goalStatement !== undefined) patch.goalStatement = String(input.goalStatement);
        if (Object.keys(patch).length === 0)
          throw new Error("Provide at least one goal field to change");
        const saved = saveSettings({ goals: patch as UserGoals }).goals;
        return JSON.stringify({ savedGoals: saved });
      },
    },
  ],
  buildContext: () => {
    const date = todayStr();
    const s = getNutritionSummary(date);
    const g = s.goals;
    const settings = getSettings();
    const weights = getWeightHistory(90);
    const latest = weights.length > 0 ? weights[weights.length - 1] : undefined;
    return JSON.stringify({
      date,
      goals: {
        calories: g.calorieGoal,
        proteinG: g.proteinGoalG,
        carbsG: g.carbsGoalG,
        fatG: g.fatGoalG,
        waterMl: g.waterGoalMl,
        weightGoal: g.weightGoal,
        weightUnit: g.weightUnit,
        goalStatement: g.goalStatement || undefined,
      },
      consumedToday: s.totals,
      remainingToday: {
        calories: r1(g.calorieGoal - s.totals.calories),
        proteinG: r1(g.proteinGoalG - s.totals.proteinG),
        carbsG: r1(g.carbsGoalG - s.totals.carbsG),
        fatG: r1(g.fatGoalG - s.totals.fatG),
      },
      waterTodayMl: Math.round(s.waterMl),
      mealsLoggedToday: s.logs
        .slice(0, 20)
        .map(
          (l) =>
            `${l.meal}: ${l.servings} x ${l.food?.name ?? "?"} (${Math.round((l.food?.calories ?? 0) * l.servings)} kcal)`,
        ),
      latestWeight: latest ? { date: latest.date, weight: latest.weight } : null,
      profile: {
        age: settings.profile.age,
        sex: settings.profile.sex,
        heightCm: settings.profile.heightCm,
        activityLevel: settings.profile.activityLevel,
      },
    });
  },
};
