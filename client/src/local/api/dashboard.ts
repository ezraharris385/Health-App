/**
 * Local-mode dashboard API: registers in-browser handlers for exactly the
 * routes server/routes/dashboard.ts serves, backed by the same shared store
 * (shared/data/stores/dashboard.ts), so client/src/api works identically
 * without a server. Same params, defaults, status codes, and error messages
 * as the Express router.
 */
import { get, LocalApiError } from "../router";
import {
  DashboardError,
  buildOverview,
  parseHistoryDays,
  parseScoreDate,
} from "@shared/data/stores/dashboard";
import { todayStr } from "@shared/data/db";
import { computeDailyScore, getScoreHistory } from "@shared/data/score";

/** Mirror of the Express respond(): map store errors to HTTP-style statuses. */
function respond(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DashboardError) throw new LocalApiError(err.status, err.message);
    throw err;
  }
}

export function registerRoutesDashboard(): void {
  // GET /api/dashboard/score?date=YYYY-MM-DD (defaults to today)
  get("/api/dashboard/score", ({ query }) =>
    respond(() => computeDailyScore(parseScoreDate(query.date))),
  );

  // GET /api/dashboard/history?days=N (default 30, capped at 90)
  get("/api/dashboard/history", ({ query }) =>
    respond(() => getScoreHistory(parseHistoryDays(query.days))),
  );

  // GET /api/dashboard/overview — today's cross-segment key numbers
  get("/api/dashboard/overview", () => respond(() => buildOverview(todayStr())));
}
