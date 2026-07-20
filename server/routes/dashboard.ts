/**
 * Dashboard routes: thin Express glue over the shared dashboard store
 * (shared/data/stores/dashboard.ts), which owns the overview builder and the
 * query validation. Paths, validation, status codes, and response shapes are
 * unchanged. Everything here is read-only — writes happen through the segment
 * routes and agents.
 *
 * The store's helpers are re-exported so existing imports from this module
 * (e.g. buildOverview / DashboardOverview) keep working.
 */
import { Router, type Response } from "express";
import {
  DashboardError,
  buildOverview,
  parseHistoryDays,
  parseScoreDate,
} from "../../shared/data/stores/dashboard";
import { todayStr } from "../db";
import { computeDailyScore, getScoreHistory } from "../score";
import { getEnergyBalance } from "../summaries";

export * from "../../shared/data/stores/dashboard";

export const dashboardRouter = Router();

function respond(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    if (err instanceof DashboardError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

// GET /api/dashboard/score?date=YYYY-MM-DD (defaults to today)
dashboardRouter.get("/score", (req, res) => {
  respond(res, () => computeDailyScore(parseScoreDate(req.query.date)));
});

// GET /api/dashboard/history?days=N (default 30, capped at 90)
dashboardRouter.get("/history", (req, res) => {
  respond(res, () => getScoreHistory(parseHistoryDays(req.query.days)));
});

// GET /api/dashboard/overview — today's cross-segment key numbers
dashboardRouter.get("/overview", (_req, res) => {
  respond(res, () => buildOverview(todayStr()));
});

// GET /api/dashboard/energy?date=YYYY-MM-DD (defaults to today) — caloric balance
dashboardRouter.get("/energy", (req, res) => {
  respond(res, () => getEnergyBalance(parseScoreDate(req.query.date)));
});
