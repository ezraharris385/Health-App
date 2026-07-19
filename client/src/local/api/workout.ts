/**
 * Local-mode API dispatchers for the workout segment. Registers handlers for
 * exactly the same paths/methods server/routes/workout.ts serves under
 * /api/workout, backed by the same shared data-access layer, so
 * client/src/api/workout.ts works identically in both modes.
 */
import { get, post, put, del, LocalApiError } from "../router";
import { isValidDateStr, todayStr } from "@shared/data/db";
import { getWorkoutDaySummary } from "@shared/data/summaries";
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
} from "@shared/data/stores/workout";

/** Same status mapping as the Express guard: HttpError keeps its status, anything else is a 400. */
function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 400;
    throw new LocalApiError(status, err instanceof Error ? err.message : String(err));
  }
}

function idParam(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid id");
  return id;
}

export function registerRoutesWorkout(): void {
  // --- Exercises
  get("/api/workout/exercises", ({ query }) =>
    run(() => listExercises(typeof query.query === "string" ? query.query : undefined)),
  );
  post("/api/workout/exercises", ({ body }) => run(() => createExercise(body ?? {})));
  put("/api/workout/exercises/:id", ({ params, body }) =>
    run(() => updateExercise(idParam(params), body ?? {})),
  );
  del("/api/workout/exercises/:id", ({ params }) =>
    run(() => {
      deleteExercise(idParam(params));
      return { ok: true };
    }),
  );

  // --- Plans
  get("/api/workout/plans", ({ query }) => run(() => listPlans(query.includeArchived === "1")));
  get("/api/workout/plans/:id", ({ params }) => run(() => getPlanFull(idParam(params))));
  post("/api/workout/plans", ({ body }) => run(() => createFullPlan(body ?? {})));
  put("/api/workout/plans/:id", ({ params, body }) =>
    run(() => updatePlan(idParam(params), body ?? {})),
  );
  del("/api/workout/plans/:id", ({ params }) =>
    run(() => {
      deletePlan(idParam(params));
      return { ok: true };
    }),
  );
  post("/api/workout/plans/:id/days", ({ params, body }) =>
    run(() => createPlanDay(idParam(params), body ?? {})),
  );
  put("/api/workout/plan-days/:id", ({ params, body }) =>
    run(() => updatePlanDay(idParam(params), body ?? {})),
  );
  del("/api/workout/plan-days/:id", ({ params }) =>
    run(() => {
      deletePlanDay(idParam(params));
      return { ok: true };
    }),
  );
  post("/api/workout/plan-days/:id/exercises", ({ params, body }) =>
    run(() => addPlanDayExercise(idParam(params), body ?? {})),
  );
  put("/api/workout/plan-exercises/:id", ({ params, body }) =>
    run(() => updatePlanDayExercise(idParam(params), body ?? {})),
  );
  del("/api/workout/plan-exercises/:id", ({ params }) =>
    run(() => {
      deletePlanDayExercise(idParam(params));
      return { ok: true };
    }),
  );

  // --- Week / day summaries
  get("/api/workout/week", ({ query }) =>
    run(() => getWeekSchedule(typeof query.date === "string" ? query.date : undefined)),
  );
  get("/api/workout/summary", ({ query }) =>
    run(() => {
      const date = typeof query.date === "string" ? query.date : todayStr();
      if (!isValidDateStr(date)) throw new Error("date must be YYYY-MM-DD");
      return getWorkoutDaySummary(date);
    }),
  );

  // --- Sessions & sets
  get("/api/workout/sessions", ({ query }) =>
    run(() => {
      const days = query.days !== undefined ? Number(query.days) : undefined;
      if (days !== undefined && !Number.isFinite(days)) throw new Error("days must be a number");
      return listSessions({
        days,
        date: typeof query.date === "string" ? query.date : undefined,
      });
    }),
  );
  get("/api/workout/sessions/:id", ({ params }) => run(() => getSessionFull(idParam(params))));
  post("/api/workout/sessions", ({ body }) => run(() => createSession(body ?? {})));
  post("/api/workout/sessions/full", ({ body }) => run(() => logFullSession(body ?? {})));
  put("/api/workout/sessions/:id", ({ params, body }) =>
    run(() => updateSession(idParam(params), body ?? {})),
  );
  post("/api/workout/sessions/:id/complete", ({ params }) =>
    run(() => completeSession(idParam(params))),
  );
  del("/api/workout/sessions/:id", ({ params }) =>
    run(() => {
      deleteSession(idParam(params));
      return { ok: true };
    }),
  );
  post("/api/workout/sessions/:id/sets", ({ params, body }) =>
    run(() => addSet(idParam(params), body ?? {})),
  );
  put("/api/workout/sets/:id", ({ params, body }) =>
    run(() => updateSet(idParam(params), body ?? {})),
  );
  del("/api/workout/sets/:id", ({ params }) =>
    run(() => {
      deleteSet(idParam(params));
      return { ok: true };
    }),
  );

  // --- Performance
  get("/api/workout/performance/:id", ({ params, query }) =>
    run(() => {
      const days = query.days !== undefined ? Number(query.days) : 180;
      if (!Number.isFinite(days)) throw new Error("days must be a number");
      return getPerformance(idParam(params), days);
    }),
  );

  // --- Cardio
  get("/api/workout/cardio", ({ query }) =>
    run(() => {
      const days = query.days !== undefined ? Number(query.days) : 90;
      if (!Number.isFinite(days)) throw new Error("days must be a number");
      return listCardio(days);
    }),
  );
  post("/api/workout/cardio", ({ body }) => run(() => createCardio(body ?? {})));
  put("/api/workout/cardio/:id", ({ params, body }) =>
    run(() => updateCardio(idParam(params), body ?? {})),
  );
  del("/api/workout/cardio/:id", ({ params }) =>
    run(() => {
      deleteCardio(idParam(params));
      return { ok: true };
    }),
  );
}
