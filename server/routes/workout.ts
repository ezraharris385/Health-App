/**
 * Workout segment routes — thin Express glue over the shared data-access
 * layer in shared/data/stores/workout.ts (which also powers the in-browser
 * local API and the workout agent's tools, so all three always agree).
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { isValidDateStr, todayStr } from "../db";
import { getWorkoutDaySummary } from "../summaries";
import {
  HttpError,
  addPlanDayExercise,
  addSet,
  completeSession,
  createCardio,
  createExercise,
  createFullPlan,
  createPlanDay,
  createSession,
  deleteCardio,
  deleteExercise,
  deletePlan,
  deletePlanDay,
  deletePlanDayExercise,
  deleteSession,
  deleteSet,
  getPerformance,
  getPlanFull,
  getSessionFull,
  getWeekSchedule,
  listCardio,
  listExercises,
  listPlans,
  listSessions,
  logFullSession,
  updateCardio,
  updateExercise,
  updatePlan,
  updatePlanDay,
  updatePlanDayExercise,
  updateSession,
  updateSet,
} from "../../shared/data/stores/workout";

// Re-export the whole store surface so existing imports from this route file
// (e.g. the workout agent def, client-mirrored types) keep working unchanged.
export * from "../../shared/data/stores/workout";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const workoutRouter = Router();

type Handler = (req: Request, res: Response) => void;
const guard =
  (fn: Handler): Handler =>
  (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };

const idParam = (req: Request): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid id");
  return id;
};

// --- Exercises
workoutRouter.get(
  "/exercises",
  guard((req, res) => {
    res.json(listExercises(typeof req.query.query === "string" ? req.query.query : undefined));
  }),
);
workoutRouter.post(
  "/exercises",
  guard((req, res) => {
    res.status(201).json(createExercise(req.body ?? {}));
  }),
);
workoutRouter.put(
  "/exercises/:id",
  guard((req, res) => {
    res.json(updateExercise(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.delete(
  "/exercises/:id",
  guard((req, res) => {
    deleteExercise(idParam(req));
    res.json({ ok: true });
  }),
);

// --- Plans
workoutRouter.get(
  "/plans",
  guard((req, res) => {
    res.json(listPlans(req.query.includeArchived === "1"));
  }),
);
workoutRouter.get(
  "/plans/:id",
  guard((req, res) => {
    res.json(getPlanFull(idParam(req)));
  }),
);
workoutRouter.post(
  "/plans",
  guard((req, res) => {
    res.status(201).json(createFullPlan(req.body ?? {}));
  }),
);
workoutRouter.put(
  "/plans/:id",
  guard((req, res) => {
    res.json(updatePlan(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.delete(
  "/plans/:id",
  guard((req, res) => {
    deletePlan(idParam(req));
    res.json({ ok: true });
  }),
);
workoutRouter.post(
  "/plans/:id/days",
  guard((req, res) => {
    res.status(201).json(createPlanDay(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.put(
  "/plan-days/:id",
  guard((req, res) => {
    res.json(updatePlanDay(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.delete(
  "/plan-days/:id",
  guard((req, res) => {
    deletePlanDay(idParam(req));
    res.json({ ok: true });
  }),
);
workoutRouter.post(
  "/plan-days/:id/exercises",
  guard((req, res) => {
    res.status(201).json(addPlanDayExercise(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.put(
  "/plan-exercises/:id",
  guard((req, res) => {
    res.json(updatePlanDayExercise(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.delete(
  "/plan-exercises/:id",
  guard((req, res) => {
    deletePlanDayExercise(idParam(req));
    res.json({ ok: true });
  }),
);

// --- Week / day summaries
workoutRouter.get(
  "/week",
  guard((req, res) => {
    res.json(getWeekSchedule(typeof req.query.date === "string" ? req.query.date : undefined));
  }),
);
workoutRouter.get(
  "/summary",
  guard((req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : todayStr();
    if (!isValidDateStr(date)) throw new Error("date must be YYYY-MM-DD");
    res.json(getWorkoutDaySummary(date));
  }),
);

// --- Sessions & sets
workoutRouter.get(
  "/sessions",
  guard((req, res) => {
    const days = req.query.days !== undefined ? Number(req.query.days) : undefined;
    if (days !== undefined && !Number.isFinite(days)) throw new Error("days must be a number");
    res.json(
      listSessions({
        days,
        date: typeof req.query.date === "string" ? req.query.date : undefined,
      }),
    );
  }),
);
workoutRouter.get(
  "/sessions/:id",
  guard((req, res) => {
    res.json(getSessionFull(idParam(req)));
  }),
);
workoutRouter.post(
  "/sessions",
  guard((req, res) => {
    res.status(201).json(createSession(req.body ?? {}));
  }),
);
workoutRouter.post(
  "/sessions/full",
  guard((req, res) => {
    res.status(201).json(logFullSession(req.body ?? {}));
  }),
);
workoutRouter.put(
  "/sessions/:id",
  guard((req, res) => {
    res.json(updateSession(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.post(
  "/sessions/:id/complete",
  guard((req, res) => {
    res.json(completeSession(idParam(req)));
  }),
);
workoutRouter.delete(
  "/sessions/:id",
  guard((req, res) => {
    deleteSession(idParam(req));
    res.json({ ok: true });
  }),
);
workoutRouter.post(
  "/sessions/:id/sets",
  guard((req, res) => {
    res.status(201).json(addSet(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.put(
  "/sets/:id",
  guard((req, res) => {
    res.json(updateSet(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.delete(
  "/sets/:id",
  guard((req, res) => {
    deleteSet(idParam(req));
    res.json({ ok: true });
  }),
);

// --- Performance
workoutRouter.get(
  "/performance/:id",
  guard((req, res) => {
    const days = req.query.days !== undefined ? Number(req.query.days) : 180;
    if (!Number.isFinite(days)) throw new Error("days must be a number");
    res.json(getPerformance(idParam(req), days));
  }),
);

// --- Cardio
workoutRouter.get(
  "/cardio",
  guard((req, res) => {
    const days = req.query.days !== undefined ? Number(req.query.days) : 90;
    if (!Number.isFinite(days)) throw new Error("days must be a number");
    res.json(listCardio(days));
  }),
);
workoutRouter.post(
  "/cardio",
  guard((req, res) => {
    res.status(201).json(createCardio(req.body ?? {}));
  }),
);
workoutRouter.put(
  "/cardio/:id",
  guard((req, res) => {
    res.json(updateCardio(idParam(req), req.body ?? {}));
  }),
);
workoutRouter.delete(
  "/cardio/:id",
  guard((req, res) => {
    deleteCardio(idParam(req));
    res.json({ ok: true });
  }),
);
