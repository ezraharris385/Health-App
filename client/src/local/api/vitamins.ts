/**
 * Local-mode vitamins API: registers in-browser handlers for exactly the
 * routes server/routes/vitamins.ts serves, backed by the same shared store
 * (shared/data/stores/vitamins.ts), so client/src/api/vitamins.ts works
 * identically without a server. Same params, defaults, status codes, and
 * error messages as the Express router.
 */
import { del, get, post, put, LocalApiError } from "../router";
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
} from "@shared/data/stores/vitamins";
import { todayStr } from "@shared/data/db";
import { getVitaminSummary } from "@shared/data/summaries";

/** Mirror of the Express respond(): map store errors to HTTP-style statuses. */
function respond(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BadRequestError) throw new LocalApiError(400, err.message);
    if (err instanceof NotFoundError) throw new LocalApiError(404, err.message);
    console.error("vitamins route error:", err);
    throw new LocalApiError(500, err instanceof Error ? err.message : "Internal error");
  }
}

export function registerRoutesVitamins(): void {
  /** Daily vitamin summary (coverage per nutrient, taken supplements, active supplements). */
  get("/api/vitamins/summary", ({ query }) =>
    respond(() => getVitaminSummary(parseDate(query.date, todayStr()))),
  );

  /** Per-day average coverage percent over the last N days. */
  get("/api/vitamins/history", ({ query }) =>
    respond(() => getCoverageHistory(parseDays(query.days, 30))),
  );

  /** Per-day supplement adherence (taken vs currently-active count) over the last N days. */
  get("/api/vitamins/adherence", ({ query }) =>
    respond(() => getAdherenceHistory(parseDays(query.days, 30))),
  );

  /** All supplements, active first. */
  get("/api/vitamins/supplements", () => respond(() => listSupplements()));

  post("/api/vitamins/supplements", ({ body }) => respond(() => createSupplement(body)));

  put("/api/vitamins/supplements/:id", ({ params, body }) =>
    respond(() => updateSupplement(parseId(params.id), body)),
  );

  del("/api/vitamins/supplements/:id", ({ params }) =>
    respond(() => {
      deleteSupplement(parseId(params.id));
      return { ok: true };
    }),
  );

  /** One-tap taken/untaken toggle. Body: { supplementId, date?, taken? }. */
  post("/api/vitamins/taken/toggle", ({ body }) =>
    respond(() => {
      const b = body ?? {};
      const supplementId = parseId(b.supplementId, "supplementId");
      const date = parseDate(b.date, todayStr());
      let taken: boolean | undefined;
      if (b.taken !== undefined) {
        if (typeof b.taken !== "boolean") throw new BadRequestError("taken must be a boolean");
        taken = b.taken;
      }
      return setTaken(supplementId, date, taken);
    }),
  );
}
