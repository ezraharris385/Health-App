/**
 * Mobility segment routes: thin Express glue over the shared mobility store
 * (shared/data/stores/mobility.ts), which owns all validation and data
 * access. Paths, validation, status codes, and response shapes match the
 * in-browser router (client/src/local/api/mobility.ts) path-for-path.
 *
 * The store's helpers are re-exported so existing imports from this module
 * (e.g. the mobility agent def) keep working.
 */
import { Router, type Response } from "express";
import { todayStr } from "../db";
import { getMobilityDaySummary } from "../summaries";
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
} from "../../shared/data/stores/mobility";

export * from "../../shared/data/stores/mobility";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function respond(res: Response, fn: () => unknown) {
  try {
    res.json(fn());
  } catch (err) {
    if (err instanceof BadRequestError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    console.error("mobility route error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}

export const mobilityRouter = Router();

/** Daily mobility summary (sessions, minutes, by-kind, assessments, latest metric scores). */
mobilityRouter.get("/summary", (req, res) =>
  respond(res, () => getMobilityDaySummary(parseDate(req.query.date, todayStr()))),
);

/** Per-day session count + minutes over the last N days, oldest first. */
mobilityRouter.get("/history", (req, res) =>
  respond(res, () => getSessionHistory(parseDays(req.query.days, 30))),
);

/** The stretch/yoga/posture bank, alphabetical. */
mobilityRouter.get("/stretches", (_req, res) => respond(res, () => listStretches()));

mobilityRouter.post("/stretches", (req, res) => respond(res, () => createStretch(req.body)));

mobilityRouter.put("/stretches/:id", (req, res) =>
  respond(res, () => updateStretch(parseId(req.params.id), req.body)),
);

mobilityRouter.delete("/stretches/:id", (req, res) =>
  respond(res, () => {
    deleteStretch(parseId(req.params.id));
    return { ok: true };
  }),
);

/** Routines with ordered items; archived excluded unless ?includeArchived=1. */
mobilityRouter.get("/routines", (req, res) =>
  respond(res, () =>
    listRoutines(req.query.includeArchived === "1" || req.query.includeArchived === "true"),
  ),
);

mobilityRouter.post("/routines", (req, res) => respond(res, () => createRoutine(req.body)));

mobilityRouter.put("/routines/:id", (req, res) =>
  respond(res, () => updateRoutine(parseId(req.params.id), req.body)),
);

mobilityRouter.delete("/routines/:id", (req, res) =>
  respond(res, () => {
    deleteRoutine(parseId(req.params.id));
    return { ok: true };
  }),
);

/** Sessions over the last N days, newest first. */
mobilityRouter.get("/sessions", (req, res) =>
  respond(res, () => listSessions(parseDays(req.query.days, 30))),
);

mobilityRouter.post("/sessions", (req, res) => respond(res, () => createSession(req.body)));

mobilityRouter.put("/sessions/:id", (req, res) =>
  respond(res, () => updateSession(parseId(req.params.id), req.body)),
);

mobilityRouter.delete("/sessions/:id", (req, res) =>
  respond(res, () => {
    deleteSession(parseId(req.params.id));
    return { ok: true };
  }),
);

/** All metrics, active first. */
mobilityRouter.get("/metrics", (_req, res) => respond(res, () => listMetrics()));

mobilityRouter.post("/metrics", (req, res) => respond(res, () => createMetric(req.body)));

mobilityRouter.put("/metrics/:id", (req, res) =>
  respond(res, () => updateMetric(parseId(req.params.id), req.body)),
);

mobilityRouter.delete("/metrics/:id", (req, res) =>
  respond(res, () => {
    deleteMetric(parseId(req.params.id));
    return { ok: true };
  }),
);

/** Assessments over the last N days (optionally one metric), oldest first for charting. */
mobilityRouter.get("/assessments", (req, res) =>
  respond(res, () => {
    const days = parseDays(req.query.days, 90);
    const metricId =
      req.query.metricId !== undefined && req.query.metricId !== ""
        ? parseId(req.query.metricId, "metricId")
        : undefined;
    return listAssessments(days, metricId);
  }),
);

mobilityRouter.post("/assessments", (req, res) => respond(res, () => createAssessment(req.body)));

mobilityRouter.delete("/assessments/:id", (req, res) =>
  respond(res, () => {
    deleteAssessment(parseId(req.params.id));
    return { ok: true };
  }),
);
