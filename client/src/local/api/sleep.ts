/**
 * Local-mode sleep API: registers in-browser handlers for exactly the routes
 * server/routes/sleep.ts serves, backed by the same shared store
 * (shared/data/stores/sleep.ts), so client/src/api works identically without
 * a server. Same params, defaults, status codes, and error messages as the
 * Express router.
 */
import { del, get, post, put, LocalApiError } from "../router";
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
} from "@shared/data/stores/sleep";

/** Mirror of the Express respond(): map store errors to HTTP-style statuses. */
function respond(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SleepError) throw new LocalApiError(err.status, err.message);
    console.error("sleep route error:", err);
    throw new LocalApiError(500, err instanceof Error ? err.message : "Internal error");
  }
}

function idParam(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new SleepError(400, "Invalid id");
  return id;
}

export function registerRoutesSleep(): void {
  get("/api/sleep/state", () =>
    respond(() => ({ open: getOpenSleepLog(), now: new Date().toISOString() })),
  );

  post("/api/sleep/bed", ({ body }) => respond(() => startSleep(body?.bedTime)));

  post("/api/sleep/wake", ({ body }) =>
    respond(() =>
      wakeUp({ wakeTime: body?.wakeTime, quality: body?.quality, notes: body?.notes }),
    ),
  );

  get("/api/sleep/logs", ({ query }) =>
    respond(() => getRecentSleepLogs(parseDays(query.days, 30))),
  );

  post("/api/sleep/logs", ({ body }) =>
    respond(() =>
      createSleepLog({
        bedTime: body?.bedTime,
        wakeTime: body?.wakeTime,
        quality: body?.quality,
        notes: body?.notes,
      }),
    ),
  );

  put("/api/sleep/logs/:id", ({ params, body }) =>
    respond(() =>
      updateSleepLog(idParam(params), {
        bedTime: body?.bedTime,
        wakeTime: body?.wakeTime,
        quality: body?.quality,
        notes: body?.notes,
      }),
    ),
  );

  del("/api/sleep/logs/:id", ({ params }) =>
    respond(() => {
      deleteSleepLog(idParam(params));
      return { ok: true };
    }),
  );

  get("/api/sleep/history", ({ query }) =>
    respond(() => getSleepHistoryDays(parseDays(query.days, 30))),
  );

  get("/api/sleep/stats", ({ query }) =>
    respond(() => computeSleepStats(parseDays(query.days, 30))),
  );
}
