/**
 * Sleep segment routes: thin Express glue over the shared sleep store
 * (shared/data/stores/sleep.ts), which owns all validation and data access.
 * Paths, validation, status codes, and response shapes are unchanged.
 *
 * The store's helpers are re-exported so existing imports from this module
 * (e.g. the sleep agent def and the dashboard overview) keep working.
 */
import { Router, type Request, type Response } from "express";
import {
  SleepError,
  computeSleepStats,
  createSleepLog,
  deleteSleepLog,
  getOpenSleepLog,
  getRecentSleepLogs,
  getSleepHistoryDays,
  parseDays,
  startSleep,
  updateSleepLog,
  wakeUp,
} from "../../shared/data/stores/sleep";

export * from "../../shared/data/stores/sleep";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const sleepRouter = Router();

function respond(res: Response, fn: () => unknown, status = 200): void {
  try {
    res.status(status).json(fn());
  } catch (err) {
    if (err instanceof SleepError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("sleep route error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new SleepError(400, "Invalid id");
  return id;
}

sleepRouter.get("/state", (_req, res) => {
  respond(res, () => ({ open: getOpenSleepLog(), now: new Date().toISOString() }));
});

sleepRouter.post("/bed", (req, res) => {
  respond(res, () => startSleep(req.body?.bedTime), 201);
});

sleepRouter.post("/wake", (req, res) => {
  respond(res, () =>
    wakeUp({ wakeTime: req.body?.wakeTime, quality: req.body?.quality, notes: req.body?.notes }),
  );
});

sleepRouter.get("/logs", (req, res) => {
  respond(res, () => getRecentSleepLogs(parseDays(req.query.days, 30)));
});

sleepRouter.post("/logs", (req, res) => {
  respond(
    res,
    () =>
      createSleepLog({
        bedTime: req.body?.bedTime,
        wakeTime: req.body?.wakeTime,
        quality: req.body?.quality,
        notes: req.body?.notes,
      }),
    201,
  );
});

sleepRouter.put("/logs/:id", (req, res) => {
  respond(res, () =>
    updateSleepLog(idParam(req), {
      bedTime: req.body?.bedTime,
      wakeTime: req.body?.wakeTime,
      quality: req.body?.quality,
      notes: req.body?.notes,
    }),
  );
});

sleepRouter.delete("/logs/:id", (req, res) => {
  respond(res, () => {
    deleteSleepLog(idParam(req));
    return { ok: true };
  });
});

sleepRouter.get("/history", (req, res) => {
  respond(res, () => getSleepHistoryDays(parseDays(req.query.days, 30)));
});

sleepRouter.get("/stats", (req, res) => {
  respond(res, () => computeSleepStats(parseDays(req.query.days, 30)));
});
