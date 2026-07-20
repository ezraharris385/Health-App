/**
 * Nutrition segment routes: thin Express glue over the shared nutrition store
 * (shared/data/stores/nutrition.ts), which owns all validation and data
 * access. Paths, validation, status codes, and response shapes are unchanged.
 *
 * The store's helpers are re-exported so existing imports from this module
 * (e.g. the nutrition agent def) keep working.
 */
import { Router, type Request, type Response } from "express";
import { todayStr } from "../db";
import { getSettings } from "../settingsStore";
import { getNutritionSummary, getWaterMlForDate, getWeightHistory } from "../summaries";
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
  getSupplementMacroContribution,
  getWaterHistoryDays,
  listFoods,
  listWaterForDate,
  parseDate,
  updateFood,
  updateFoodLog,
  upsertWeight,
} from "../../shared/data/stores/nutrition";

export * from "../../shared/data/stores/nutrition";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function respond(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    if (err instanceof BadRequestError) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
    } else {
      console.error("nutrition route error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  }
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("invalid id");
  return id;
}

export const nutritionRouter = Router();

// Food library
nutritionRouter.get("/foods", (req, res) =>
  respond(res, () => listFoods(typeof req.query.q === "string" ? req.query.q : undefined)),
);
nutritionRouter.post("/foods", (req, res) => respond(res, () => createFood(req.body, "user")));
nutritionRouter.put("/foods/:id", (req, res) =>
  respond(res, () => updateFood(idParam(req), req.body)),
);
nutritionRouter.delete("/foods/:id", (req, res) =>
  respond(res, () => {
    deleteFood(idParam(req));
    return { ok: true };
  }),
);

// Daily summary + food log
nutritionRouter.get("/summary", (req, res) =>
  respond(res, () => getNutritionSummary(parseDate(req.query.date, todayStr()))),
);

// Read-only breakdown of macros contributed by taken supplements (already
// folded into /summary totals by getNutritionSummary — shown, never re-added).
nutritionRouter.get("/supplement-macros", (req, res) =>
  respond(res, () => getSupplementMacroContribution(parseDate(req.query.date, todayStr()))),
);
nutritionRouter.post("/log", (req, res) => respond(res, () => createFoodLog(req.body ?? {})));
nutritionRouter.put("/log/:id", (req, res) =>
  respond(res, () => updateFoodLog(idParam(req), req.body ?? {})),
);
nutritionRouter.delete("/log/:id", (req, res) =>
  respond(res, () => {
    deleteFoodLog(idParam(req));
    return { ok: true };
  }),
);

// Calorie/macro history (day-aligned incl. zero days)
nutritionRouter.get("/history", (req, res) =>
  respond(res, () => ({
    days: getMacroHistory(clampDays(req.query.days, 30)),
    goals: getSettings().goals,
  })),
);

// Water ("/water/history" must precede any parametrized siblings)
nutritionRouter.get("/water/history", (req, res) =>
  respond(res, () => ({
    days: getWaterHistoryDays(clampDays(req.query.days, 30)),
    goalMl: getSettings().goals.waterGoalMl,
  })),
);
nutritionRouter.get("/water", (req, res) =>
  respond(res, () => {
    const date = parseDate(req.query.date, todayStr());
    return {
      date,
      totalMl: getWaterMlForDate(date),
      goalMl: getSettings().goals.waterGoalMl,
      entries: listWaterForDate(date),
    };
  }),
);
nutritionRouter.post("/water", (req, res) =>
  respond(res, () => addWater(req.body?.amountMl, req.body?.date)),
);
nutritionRouter.delete("/water/:id", (req, res) =>
  respond(res, () => {
    deleteWater(idParam(req));
    return { ok: true };
  }),
);

// Weight
nutritionRouter.get("/weight", (req, res) =>
  respond(res, () => {
    const goals = getSettings().goals;
    return {
      entries: getWeightHistory(clampDays(req.query.days, 90)),
      weightGoal: goals.weightGoal,
      weightUnit: goals.weightUnit,
    };
  }),
);
nutritionRouter.post("/weight", (req, res) =>
  respond(res, () => upsertWeight(req.body?.weight, req.body?.date)),
);
nutritionRouter.delete("/weight/:id", (req, res) =>
  respond(res, () => {
    deleteWeight(idParam(req));
    return { ok: true };
  }),
);
