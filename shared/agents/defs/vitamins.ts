/**
 * Vitamins segment agent: micronutrient coverage analysis, supplement
 * management, and food-first recommendations for closing nutrient gaps.
 * All data access goes through the helpers exported by
 * shared/data/stores/vitamins.ts so agent writes follow the exact same
 * validation as the HTTP API.
 */
import type { AgentDef } from "../framework";
import { todayStr, isValidDateStr } from "../../data/db";
import { getVitaminSummary } from "../../data/summaries";
import { NUTRIENT_KEYS, NUTRIENT_BY_KEY } from "../../nutrients";
import {
  analyzeCoverageTrends,
  createSupplement,
  getCoverageHistory,
  getDeficiencyContext,
  listSupplements,
  setTaken,
  takenIdsForDate,
  updateSupplement,
} from "../../data/stores/vitamins";

function parseDateOrToday(v: unknown): string {
  if (v === undefined || v === null || v === "") return todayStr();
  if (!isValidDateStr(v)) throw new Error("date must be YYYY-MM-DD");
  return v;
}

function clampDays(v: unknown, def: number): number {
  if (v === undefined || v === null) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 90)
    throw new Error("days must be an integer between 1 and 90");
  return n;
}

const nutrientKeyProp = {
  type: "object",
  description:
    "Per-dose nutrient amounts keyed by nutrient key. Valid keys: " + NUTRIENT_KEYS.join(", "),
  additionalProperties: { type: "number" },
};

/**
 * Optional per-dose macro schema properties shared by create/update tools.
 * These feed the Nutrition calorie/macro tracker on days the supplement is
 * marked taken. Each defaults to 0 when omitted.
 */
const macroProps = {
  calories: { type: "number", description: "Calories per dose in kcal (default 0)" },
  proteinG: { type: "number", description: "Protein per dose in grams (default 0)" },
  carbsG: { type: "number", description: "Carbohydrate per dose in grams (default 0)" },
  fatG: { type: "number", description: "Fat per dose in grams (default 0)" },
  sugarG: { type: "number", description: "Sugar per dose in grams (default 0)" },
  sodiumMg: { type: "number", description: "Sodium per dose in milligrams (default 0)" },
};

interface MacroInput {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

export const vitaminsAgent: AgentDef = {
  name: "vitamins",
  title: "Micronutrient Assistant",
  persona: `You are the Micronutrient Assistant in a personal health-tracking app. You own the vitamins, minerals & brain-nutrient segment: 22 tracked nutrients grouped as Vitamins (A/C/D/E/K, the B vitamins), Minerals (calcium, iron, magnesium, zinc, potassium, selenium), Brain & fatty acids (omega-3 EPA, omega-3 DHA, omega-3 ALA, and choline), and fiber — each with a daily target, the user's supplement library, and the daily taken/untaken checklist. Coverage numbers combine micros from logged foods plus nutrients from supplements marked taken.

How you work:
- Read before you write. Use get_coverage or get_deficiency_context to see today's actual numbers before advising; use get_coverage_trends to spot chronic gaps (average coverage under ~60% over a week or more) rather than reacting to a single day.
- Food first, supplements second. When a nutrient is short, use get_deficiency_context to get the exact amount still needed, then recommend 2-3 specific foods with realistic portions and approximate amounts from your nutrition knowledge (e.g. "one kiwi ≈ 60 mg vitamin C").
- Brain & mental performance: the omega-3s (EPA/DHA) and choline support cognition, mood and memory. For EPA/DHA push oily fish (salmon, sardines, mackerel, anchovies) ~2x/week, or a fish-oil / (vegan) algae-oil supplement — algae oil is the reliable plant DHA source. For ALA use walnuts, ground flax, chia, hemp. For choline lean on eggs (the yolk ≈ 150 mg), liver, beef and soybeans. Combined EPA+DHA ~250-500 mg/day is a sensible general target; note fish oil can carry calories/fat worth logging as a supplement macro. Tie advice back to the user's mental-performance goal when they raise it. You must NOT create food entries or log meals — that belongs to the nutrition agent; tell the user to log foods on the Nutrition page or ask its agent. Only suggest a new supplement when diet realistically can't close the gap (vitamin D is a common example).
- Safety: every nutrient has an upper limit where one exists (e.g. zinc 40 mg, vitamin A 3000 mcg). Flag anything trending over its upper limit in get_coverage_trends and advise dialing back before suggesting more of it. Warn before creating supplement stacks that would exceed limits.
- Acting: manage supplements with create_supplement / update_supplement (per-dose contents keyed by nutrient keys; deactivate instead of deleting), and mark doses with toggle_taken. Only write what actually happened: NEVER create a supplement or mark one taken because you recommended it — a recommendation stays a recommendation until the user says they own the supplement or actually took the dose. Confirm with the user before deactivating or overwriting a supplement's contents, and after any write briefly state what changed with the numbers.
- Macros: supplements can carry per-dose macros (calories, protein, carbs, fat, sugar, sodium). These are NOT just for micronutrients — on any day a supplement is marked taken, its macros are added into the user's Nutrition calorie and macro totals automatically. So when you create or update a supplement that actually carries calories (protein powder, greens/meal-replacement powder, sugary gummy vitamins, mass gainers), fill the macro fields from public label knowledge; leave them at 0 for calorie-free pills. Mention this link when it matters (e.g. "these gummies add ~15 kcal / 3 g sugar to your Nutrition totals each day you log them").
- Memory: use save_memory for durable facts — dietary restrictions (vegan, dairy-free), diagnosed deficiencies, doctor recommendations, supplement schedules, what worked. Saved memories and a live <context> snapshot of today's coverage are injected into every turn; rely on them but re-read tools for exact figures.

Tone: a precise, encouraging micronutrient coach. Concrete numbers and units, short actionable answers, no filler.`,
  tools: [
    {
      name: "get_coverage",
      description:
        "Read the full micronutrient coverage for a date (default today): per-nutrient consumed vs target with the food/supplement split and percent covered, plus which supplements were taken that day. Sorted worst-covered first.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD; omit for today" },
        },
      },
      run: (input: { date?: string }) => {
        const date = parseDateOrToday(input?.date);
        const s = getVitaminSummary(date);
        const coverage = [...s.coverage]
          .sort((a, b) => a.percent - b.percent)
          .map((c) => ({
            key: c.key,
            label: c.label,
            percent: c.percent,
            consumed: c.consumed,
            target: c.target,
            unit: c.unit,
            fromFood: c.fromFood,
            fromSupplements: c.fromSupplements,
            upperLimit: NUTRIENT_BY_KEY[c.key]?.upperLimit ?? null,
          }));
        const avg =
          coverage.length === 0
            ? 0
            : Math.round(coverage.reduce((a, c) => a + c.percent, 0) / coverage.length);
        return JSON.stringify({
          date,
          avgCoveragePercent: avg,
          coverage,
          supplementsTaken: s.supplementsTaken.map((t) => ({
            supplementId: t.supplementId,
            name: t.supplementName,
          })),
        });
      },
    },
    {
      name: "get_coverage_trends",
      description:
        "Analyze coverage over the last N days (default 14, max 90): per-nutrient average coverage %, average intake and food/supplement split, chronically low nutrients (avg < 60%), nutrients that exceeded their upper limit on any day (daysOverLimit), and the per-day average coverage series. Use this to find chronic gaps and over-supplementation before recommending changes.",
      input_schema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Window size in days, 1-90 (default 14)" },
        },
      },
      run: (input: { days?: number }) => {
        const days = clampDays(input?.days, 14);
        const analysis = analyzeCoverageTrends(days);
        const daily = getCoverageHistory(days);
        return JSON.stringify({ ...analysis, dailyAvgPercent: daily });
      },
    },
    {
      name: "get_deficiency_context",
      description:
        "Get today's (or a given date's) deficient nutrients with the exact amount still needed to reach each target, sorted worst-first, including upper limits. Use this before recommending foods so your suggestions carry real numbers. Recommend foods from your own knowledge — do NOT create food entries; food creation/logging belongs to the nutrition agent.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD; omit for today" },
        },
      },
      run: (input: { date?: string }) =>
        JSON.stringify(getDeficiencyContext(parseDateOrToday(input?.date))),
    },
    {
      name: "list_supplements",
      description:
        "List every supplement in the library (active and inactive) with per-dose nutrient contents, per-dose macros (calories/protein/carbs/fat/sugar/sodium — what each taken dose adds to Nutrition totals), notes, and whether each was taken today. Read this before creating, editing, or toggling supplements so you use real ids, avoid duplicates, and can verify or truthfully report an existing supplement's macros before a partial update.",
      input_schema: { type: "object", properties: {} },
      run: () => {
        const taken = new Set(takenIdsForDate(todayStr()));
        return JSON.stringify(
          listSupplements().map((s) => ({
            id: s.id,
            name: s.name,
            active: s.active === 1,
            takenToday: taken.has(s.id),
            nutrientsPerDose: s.nutrients,
            macrosPerDose: {
              calories: s.calories,
              proteinG: s.proteinG,
              carbsG: s.carbsG,
              fatG: s.fatG,
              sugarG: s.sugarG,
              sodiumMg: s.sodiumMg,
            },
            notes: s.notes,
          })),
        );
      },
    },
    {
      name: "create_supplement",
      description:
        "Create a supplement with its per-dose nutrient contents (created active). Use exact nutrient keys and per-dose amounts in each nutrient's own unit (mg/mcg/g as defined). Optionally include per-dose macros (calories, proteinG, carbsG, fatG, sugarG, sodiumMg) — these count toward the user's Nutrition calories/macros on days the supplement is marked taken, so fill them from public label knowledge for a known product (e.g. a protein powder, a greens or meal-replacement powder, gummy vitamins with sugar); leave them at 0 for calorie-free pills. Check list_supplements first to avoid duplicates, and check upper limits before stacking.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Supplement name, e.g. 'Daily Multivitamin'" },
          nutrients: nutrientKeyProp,
          ...macroProps,
          notes: { type: "string", description: "Optional notes (brand, dosing schedule...)" },
        },
        required: ["name", "nutrients"],
      },
      run: (
        input: { name: string; nutrients: Record<string, number>; notes?: string } & MacroInput,
      ) => {
        const s = createSupplement(input);
        return JSON.stringify({ created: true, supplement: s });
      },
    },
    {
      name: "update_supplement",
      description:
        "Update a supplement by id: rename, replace its per-dose nutrient contents (full replacement — include ALL nutrients it should have), edit notes, update per-dose macros (calories, proteinG, carbsG, fatG, sugarG, sodiumMg — omitted macro fields keep their current value), or activate/deactivate it (active: true/false). Deactivate rather than delete when the user stops taking something. Confirm with the user before overwriting contents or deactivating.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Supplement id from list_supplements" },
          name: { type: "string" },
          nutrients: nutrientKeyProp,
          ...macroProps,
          notes: { type: "string" },
          active: { type: "boolean", description: "true = active, false = deactivated" },
        },
        required: ["id"],
      },
      run: (
        input: {
          id: number;
          name?: string;
          nutrients?: Record<string, number>;
          notes?: string;
          active?: boolean;
        } & MacroInput,
      ) => {
        const { id, ...patch } = input;
        if (!Number.isInteger(id) || id <= 0) throw new Error("id must be a positive integer");
        const s = updateSupplement(id, patch);
        return JSON.stringify({ updated: true, supplement: s });
      },
    },
    {
      name: "toggle_taken",
      description:
        "Mark a supplement taken or untaken for a date (default today). Omit 'taken' to flip the current state; pass taken:true/false to force it. Uniqueness per (date, supplement) is guaranteed. Returns the resulting state.",
      input_schema: {
        type: "object",
        properties: {
          supplementId: { type: "number", description: "Supplement id from list_supplements" },
          date: { type: "string", description: "YYYY-MM-DD; omit for today" },
          taken: {
            type: "boolean",
            description: "Force taken (true) or untaken (false); omit to toggle",
          },
        },
        required: ["supplementId"],
      },
      run: (input: { supplementId: number; date?: string; taken?: boolean }) => {
        if (!Number.isInteger(input?.supplementId) || input.supplementId <= 0)
          throw new Error("supplementId must be a positive integer");
        if (input.taken !== undefined && typeof input.taken !== "boolean")
          throw new Error("taken must be a boolean");
        const state = setTaken(input.supplementId, parseDateOrToday(input.date), input.taken);
        return JSON.stringify(state);
      },
    },
  ],
  buildContext: () => {
    const date = todayStr();
    const s = getVitaminSummary(date);
    const sorted = [...s.coverage].sort((a, b) => a.percent - b.percent);
    const avg =
      sorted.length === 0
        ? 0
        : Math.round(sorted.reduce((a, c) => a + c.percent, 0) / sorted.length);
    const takenIds = new Set(s.supplementsTaken.map((t) => t.supplementId));
    const overLimit = s.coverage
      .filter((c) => {
        const ul = NUTRIENT_BY_KEY[c.key]?.upperLimit;
        return ul != null && c.consumed > ul;
      })
      .map((c) => c.key);
    return JSON.stringify({
      date,
      avgCoveragePercent: avg,
      fullyCovered: sorted.filter((c) => c.percent >= 100).length,
      totalTracked: sorted.length,
      lowestNutrients: sorted.slice(0, 6).map((c) => ({
        key: c.key,
        percent: c.percent,
        stillNeeded: Math.round(Math.max(0, c.target - c.consumed) * 100) / 100,
        unit: c.unit,
      })),
      overUpperLimitToday: overLimit,
      activeSupplements: s.activeSupplements.map((x) => {
        // Only calorie/macro-carrying supplements surface macros here (keeps the
        // snapshot lean); use list_supplements for every field on every row.
        const hasMacros =
          x.calories || x.proteinG || x.carbsG || x.fatG || x.sugarG || x.sodiumMg;
        return {
          id: x.id,
          name: x.name,
          takenToday: takenIds.has(x.id),
          ...(hasMacros
            ? {
                macrosPerDose: {
                  calories: x.calories,
                  proteinG: x.proteinG,
                  carbsG: x.carbsG,
                  fatG: x.fatG,
                  sugarG: x.sugarG,
                  sodiumMg: x.sodiumMg,
                },
              }
            : {}),
        };
      }),
    });
  },
};
