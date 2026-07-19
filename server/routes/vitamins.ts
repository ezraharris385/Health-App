/**
 * Vitamins segment routes: thin Express glue over the shared vitamins store
 * (shared/data/stores/vitamins.ts), which owns all validation and data
 * access. Paths, validation, status codes, and response shapes are unchanged.
 *
 * The store's helpers are re-exported so existing imports from this module
 * (e.g. the vitamins agent def) keep working.
 */
import { Router, type Response } from "express";
import { todayStr } from "../db";
import { getVitaminSummary } from "../summaries";
import {
  BadRequestError,
  NotFoundError,
  createSupplement,
  deleteSupplement,
  getAdherenceHistory,
  getCoverageHistory,
  listSupplements,
  parseDate,
  parseDays,
  parseId,
  setTaken,
  updateSupplement,
} from "../../shared/data/stores/vitamins";

export * from "../../shared/data/stores/vitamins";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function respond(res: Response, fn: () => unknown) {
  try {
    res.json(fn());
  } catch (err) {
    if (err instanceof BadRequestError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    console.error("vitamins route error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}

export const vitaminsRouter = Router();

/** Daily vitamin summary (coverage per nutrient, taken supplements, active supplements). */
vitaminsRouter.get("/summary", (req, res) =>
  respond(res, () => getVitaminSummary(parseDate(req.query.date, todayStr()))),
);

/** Per-day average coverage percent over the last N days. */
vitaminsRouter.get("/history", (req, res) =>
  respond(res, () => getCoverageHistory(parseDays(req.query.days, 30))),
);

/** Per-day supplement adherence (taken vs currently-active count) over the last N days. */
vitaminsRouter.get("/adherence", (req, res) =>
  respond(res, () => getAdherenceHistory(parseDays(req.query.days, 30))),
);

/** All supplements, active first. */
vitaminsRouter.get("/supplements", (_req, res) => respond(res, () => listSupplements()));

vitaminsRouter.post("/supplements", (req, res) =>
  respond(res, () => createSupplement(req.body)),
);

vitaminsRouter.put("/supplements/:id", (req, res) =>
  respond(res, () => updateSupplement(parseId(req.params.id), req.body)),
);

vitaminsRouter.delete("/supplements/:id", (req, res) =>
  respond(res, () => {
    deleteSupplement(parseId(req.params.id));
    return { ok: true };
  }),
);

/** One-tap taken/untaken toggle. Body: { supplementId, date?, taken? }. */
vitaminsRouter.post("/taken/toggle", (req, res) =>
  respond(res, () => {
    const body = req.body ?? {};
    const supplementId = parseId(body.supplementId, "supplementId");
    const date = parseDate(body.date, todayStr());
    let taken: boolean | undefined;
    if (body.taken !== undefined) {
      if (typeof body.taken !== "boolean") throw new BadRequestError("taken must be a boolean");
      taken = body.taken;
    }
    return setTaken(supplementId, date, taken);
  }),
);
