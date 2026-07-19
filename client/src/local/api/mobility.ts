/**
 * Local-mode mobility API: registers in-browser handlers for exactly the
 * routes server/routes/mobility.ts serves, backed by the same shared store
 * (shared/data/stores/mobility.ts), so client/src/api/mobility.ts works
 * identically without a server. Same params, defaults, status codes, and
 * error messages as the Express router.
 */
import { del, get, post, put, LocalApiError } from "../router";
import {
  BadRequestError,
  NotFoundError,
  createAssessment,
  createMetric,
  createRoutine,
  createSession,
  createStretch,
  deleteAssessment,
  deleteMetric,
  deleteRoutine,
  deleteSession,
  deleteStretch,
  getSessionHistory,
  listAssessments,
  listMetrics,
  listRoutines,
  listSessions,
  listStretches,
  parseDate,
  parseDays,
  parseId,
  updateMetric,
  updateRoutine,
  updateSession,
  updateStretch,
} from "@shared/data/stores/mobility";
import { todayStr } from "@shared/data/db";
import { getMobilityDaySummary } from "@shared/data/summaries";

/** Mirror of the Express respond(): map store errors to HTTP-style statuses. */
function respond(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BadRequestError) throw new LocalApiError(400, err.message);
    if (err instanceof NotFoundError) throw new LocalApiError(404, err.message);
    console.error("mobility route error:", err);
    throw new LocalApiError(500, err instanceof Error ? err.message : "Internal error");
  }
}

export function registerRoutesMobility(): void {
  /** Daily mobility summary (sessions, minutes, by-kind, assessments, latest metric scores). */
  get("/api/mobility/summary", ({ query }) =>
    respond(() => getMobilityDaySummary(parseDate(query.date, todayStr()))),
  );

  /** Per-day session count + minutes over the last N days, oldest first. */
  get("/api/mobility/history", ({ query }) =>
    respond(() => getSessionHistory(parseDays(query.days, 30))),
  );

  /** The stretch/yoga/posture bank, alphabetical. */
  get("/api/mobility/stretches", () => respond(() => listStretches()));

  post("/api/mobility/stretches", ({ body }) => respond(() => createStretch(body)));

  put("/api/mobility/stretches/:id", ({ params, body }) =>
    respond(() => updateStretch(parseId(params.id), body)),
  );

  del("/api/mobility/stretches/:id", ({ params }) =>
    respond(() => {
      deleteStretch(parseId(params.id));
      return { ok: true };
    }),
  );

  /** Routines with ordered items; archived excluded unless ?includeArchived=1. */
  get("/api/mobility/routines", ({ query }) =>
    respond(() =>
      listRoutines(query.includeArchived === "1" || query.includeArchived === "true"),
    ),
  );

  post("/api/mobility/routines", ({ body }) => respond(() => createRoutine(body)));

  put("/api/mobility/routines/:id", ({ params, body }) =>
    respond(() => updateRoutine(parseId(params.id), body)),
  );

  del("/api/mobility/routines/:id", ({ params }) =>
    respond(() => {
      deleteRoutine(parseId(params.id));
      return { ok: true };
    }),
  );

  /** Sessions over the last N days, newest first. */
  get("/api/mobility/sessions", ({ query }) =>
    respond(() => listSessions(parseDays(query.days, 30))),
  );

  post("/api/mobility/sessions", ({ body }) => respond(() => createSession(body)));

  put("/api/mobility/sessions/:id", ({ params, body }) =>
    respond(() => updateSession(parseId(params.id), body)),
  );

  del("/api/mobility/sessions/:id", ({ params }) =>
    respond(() => {
      deleteSession(parseId(params.id));
      return { ok: true };
    }),
  );

  /** All metrics, active first. */
  get("/api/mobility/metrics", () => respond(() => listMetrics()));

  post("/api/mobility/metrics", ({ body }) => respond(() => createMetric(body)));

  put("/api/mobility/metrics/:id", ({ params, body }) =>
    respond(() => updateMetric(parseId(params.id), body)),
  );

  del("/api/mobility/metrics/:id", ({ params }) =>
    respond(() => {
      deleteMetric(parseId(params.id));
      return { ok: true };
    }),
  );

  /** Assessments over the last N days (optionally one metric), oldest first for charting. */
  get("/api/mobility/assessments", ({ query }) =>
    respond(() => {
      const days = parseDays(query.days, 90);
      const metricId =
        query.metricId !== undefined && query.metricId !== ""
          ? parseId(query.metricId, "metricId")
          : undefined;
      return listAssessments(days, metricId);
    }),
  );

  post("/api/mobility/assessments", ({ body }) => respond(() => createAssessment(body)));

  del("/api/mobility/assessments/:id", ({ params }) =>
    respond(() => {
      deleteAssessment(parseId(params.id));
      return { ok: true };
    }),
  );
}
