/**
 * Local-mode nutrition API: registers in-browser handlers for exactly the
 * routes server/routes/nutrition.ts serves, backed by the same shared store
 * (shared/data/stores/nutrition.ts), so client/src/api/nutrition.ts works
 * identically without a server. Same params, defaults, status codes, and
 * error messages as the Express router.
 */
import { del, get, post, put, LocalApiError } from "../router";
import {
  BadRequestError,
  NotFoundError,
  addWater,
  clampDays,
  createFood,
  createFoodLog,
  deleteFood,
  deleteFoodLog,
  deleteWater,
  deleteWeight,
  getMacroHistory,
  getWaterHistoryDays,
  listFoods,
  listWaterForDate,
  parseDate,
  updateFood,
  updateFoodLog,
  upsertWeight,
} from "@shared/data/stores/nutrition";
import { todayStr } from "@shared/data/db";
import { getSettings } from "@shared/data/settingsStore";
import {
  getNutritionSummary,
  getWaterMlForDate,
  getWeightHistory,
} from "@shared/data/summaries";

/** Mirror of the Express respond(): map store errors to HTTP-style statuses. */
function respond(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BadRequestError) throw new LocalApiError(400, err.message);
    if (err instanceof NotFoundError) throw new LocalApiError(404, err.message);
    console.error("nutrition route error:", err);
    throw new LocalApiError(500, err instanceof Error ? err.message : "Internal error");
  }
}

function idParam(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("invalid id");
  return id;
}

export function registerRoutesNutrition(): void {
  // Food library
  get("/api/nutrition/foods", ({ query }) =>
    respond(() => listFoods(typeof query.q === "string" ? query.q : undefined)),
  );
  post("/api/nutrition/foods", ({ body }) => respond(() => createFood(body, "user")));
  put("/api/nutrition/foods/:id", ({ params, body }) =>
    respond(() => updateFood(idParam(params), body)),
  );
  del("/api/nutrition/foods/:id", ({ params }) =>
    respond(() => {
      deleteFood(idParam(params));
      return { ok: true };
    }),
  );

  // Daily summary + food log
  get("/api/nutrition/summary", ({ query }) =>
    respond(() => getNutritionSummary(parseDate(query.date, todayStr()))),
  );
  post("/api/nutrition/log", ({ body }) => respond(() => createFoodLog(body ?? {})));
  put("/api/nutrition/log/:id", ({ params, body }) =>
    respond(() => updateFoodLog(idParam(params), body ?? {})),
  );
  del("/api/nutrition/log/:id", ({ params }) =>
    respond(() => {
      deleteFoodLog(idParam(params));
      return { ok: true };
    }),
  );

  // Calorie/macro history (day-aligned incl. zero days)
  get("/api/nutrition/history", ({ query }) =>
    respond(() => ({
      days: getMacroHistory(clampDays(query.days, 30)),
      goals: getSettings().goals,
    })),
  );

  // Water ("/water/history" must precede any parametrized siblings)
  get("/api/nutrition/water/history", ({ query }) =>
    respond(() => ({
      days: getWaterHistoryDays(clampDays(query.days, 30)),
      goalMl: getSettings().goals.waterGoalMl,
    })),
  );
  get("/api/nutrition/water", ({ query }) =>
    respond(() => {
      const date = parseDate(query.date, todayStr());
      return {
        date,
        totalMl: getWaterMlForDate(date),
        goalMl: getSettings().goals.waterGoalMl,
        entries: listWaterForDate(date),
      };
    }),
  );
  post("/api/nutrition/water", ({ body }) =>
    respond(() => addWater(body?.amountMl, body?.date)),
  );
  del("/api/nutrition/water/:id", ({ params }) =>
    respond(() => {
      deleteWater(idParam(params));
      return { ok: true };
    }),
  );

  // Weight
  get("/api/nutrition/weight", ({ query }) =>
    respond(() => {
      const goals = getSettings().goals;
      return {
        entries: getWeightHistory(clampDays(query.days, 90)),
        weightGoal: goals.weightGoal,
        weightUnit: goals.weightUnit,
      };
    }),
  );
  post("/api/nutrition/weight", ({ body }) =>
    respond(() => upsertWeight(body?.weight, body?.date)),
  );
  del("/api/nutrition/weight/:id", ({ params }) =>
    respond(() => {
      deleteWeight(idParam(params));
      return { ok: true };
    }),
  );
}
