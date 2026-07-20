/**
 * Mobility Coach agent: stretch/yoga/posture bank, routines, session logging
 * with qualitative reports, and user-defined 1-10 metrics tracked over time.
 * All data access goes through the helpers exported by
 * shared/data/stores/mobility.ts so agent writes follow the exact same
 * validation as the HTTP API.
 */
import type { AgentDef, ToolDef } from "../framework";
import { todayStr } from "../../data/db";
import { getMobilityDaySummary } from "../../data/summaries";
import {
  ANIM_KINDS,
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
  getAssessmentById,
  getMetricById,
  getMetricTrend,
  getRecentSessionReports,
  getRoutineWithItems,
  getSessionById,
  getSessionHistory,
  getStretchById,
  listMetrics,
  listRoutines,
  listStretches,
  parseDate,
  parseDays,
  parseId,
  updateMetric,
  updateRoutine,
  updateSession,
  updateStretch,
} from "../../data/stores/mobility";

const itemProps = {
  stretchId: { type: "number", description: "Stretch id from list_stretches (must exist)" },
  holdSeconds: {
    type: ["number", "null"],
    description: "Hold time per rep/side in seconds (positive integer), or null",
  },
  reps: { type: ["number", "null"], description: "Repetitions (positive integer), or null" },
  perSide: { type: "boolean", description: "true when performed once per side (default false)" },
  notes: { type: "string", description: "Item-specific cue, e.g. 'use strap'" },
} as const;

const tools: ToolDef[] = [
  // --------------------------------------------------------------- read/today
  {
    name: "get_today_summary",
    description:
      "Read the mobility summary for a date (default today): sessions with duration/feel/report, total minutes, session count by kind, assessments logged that day, and the latest score per active metric. Read this before advising or logging.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
    },
    run: (input: { date?: string }) =>
      JSON.stringify(getMobilityDaySummary(parseDate(input?.date, todayStr()))),
  },
  {
    name: "get_session_history",
    description:
      "Per-day session count and total mobility minutes over the last N days (default 30, max 365), oldest first. Use it to judge consistency and weekly volume before recommending changes.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-back window in days, 1-365 (default 30)" },
      },
    },
    run: (input: { days?: number }) =>
      JSON.stringify(getSessionHistory(parseDays(input?.days, 30))),
  },
  // ------------------------------------------------------------ stretch bank
  {
    name: "list_stretches",
    description:
      "List the stretch/yoga/posture bank (id, name, category, target areas, form instructions, default hold seconds, notes), alphabetical. Always check here before creating stretches or routine items so you use real ids and avoid duplicates.",
    input_schema: { type: "object", properties: {} },
    run: () => JSON.stringify(listStretches()),
  },
  {
    name: "create_stretch",
    description:
      "Add a stretch, yoga pose, or posture drill to the bank. Always fill `instructions` with concise form cues (setup, execution, common mistakes) and `targetAreas` (comma-separated, e.g. 'hamstrings, hips'). ALSO fill the coaching fields the user sees on the pose card: `goal` (what it's for), `focus` (the primary theme/area to focus on), `feelWhere` (where they should feel the stretch), and pick the `animKind` that best matches the movement so the on-screen figure animates fittingly.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'Couch Stretch', 'Downward Dog'" },
        category: {
          type: "string",
          enum: ["stretch", "yoga", "posture"],
          description: "Default 'stretch'",
        },
        targetAreas: { type: "string", description: "Comma-separated, e.g. 'hip flexors, quads'" },
        instructions: { type: "string", description: "Form cues: setup, execution, mistakes" },
        defaultHoldSeconds: {
          type: ["number", "null"],
          description: "Typical hold in seconds (positive integer), or null",
        },
        goal: {
          type: "string",
          description: "What the pose is for, e.g. 'loosen tight hamstrings before running'",
        },
        focus: { type: "string", description: "Primary focus area/theme, e.g. 'posterior chain'" },
        feelWhere: {
          type: "string",
          description: "Where you should feel it, e.g. 'back of the thighs, behind the knees'",
        },
        animKind: {
          type: "string",
          enum: ANIM_KINDS,
          description:
            "Illustrative animation; pick the closest match to the movement. Default 'none' (a neutral standing figure).",
        },
        notes: { type: "string" },
      },
      required: ["name"],
    },
    run: (input: any) => JSON.stringify({ created: true, stretch: createStretch(input) }),
  },
  {
    name: "update_stretch",
    description:
      "Update a bank stretch by id: rename, change category (stretch/yoga/posture), edit target areas, instructions, default hold seconds (null clears), the coaching fields goal/focus/feelWhere, the animKind, or notes. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Stretch id from list_stretches" },
        name: { type: "string" },
        category: { type: "string", enum: ["stretch", "yoga", "posture"] },
        targetAreas: { type: "string" },
        instructions: { type: "string" },
        defaultHoldSeconds: { type: ["number", "null"] },
        goal: { type: "string", description: "What the pose is for" },
        focus: { type: "string", description: "Primary focus area/theme" },
        feelWhere: { type: "string", description: "Where you should feel it" },
        animKind: {
          type: "string",
          enum: ANIM_KINDS,
          description: "Illustrative animation matching the movement",
        },
        notes: { type: "string" },
      },
      required: ["id"],
    },
    run: (input: { id: number; [k: string]: unknown }) => {
      const { id, ...patch } = input;
      return JSON.stringify({ updated: true, stretch: updateStretch(parseId(id), patch) });
    },
  },
  {
    name: "delete_stretch",
    description:
      "Delete a stretch from the bank by id (e.g. a duplicate). Destructive: it is also removed from every routine that includes it. Confirm with the user first, quoting the stretch's name.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Stretch id from list_stretches" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      const id = parseId(input?.id);
      const stretch = getStretchById(id);
      deleteStretch(id);
      return JSON.stringify({ deleted: true, stretch });
    },
  },
  // ---------------------------------------------------------------- routines
  {
    name: "list_routines",
    description:
      "List mobility routines with their ordered items (stretch name, hold seconds, reps, per-side, notes). Archived routines are excluded unless includeArchived is true. Read this before creating or editing routines.",
    input_schema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "Include archived routines (default false)",
        },
      },
    },
    run: (input: { includeArchived?: boolean }) =>
      JSON.stringify(listRoutines(Boolean(input?.includeArchived))),
  },
  {
    name: "create_full_routine",
    description:
      "Create a COMPLETE mobility routine in one call: the routine plus its ordered items referencing bank stretches (item order = array order). Every stretchId must exist — call list_stretches first and create_stretch for anything missing. When you create those poses, fill their goal / focus / feelWhere and choose a fitting animKind so they show up richly in the bank and in the Follow-mode player. Use this whenever the user asks for a routine (e.g. 'morning hip opener', 'desk posture reset').",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Routine name, e.g. 'Morning Hip Opener'" },
        description: { type: "string" },
        focus: { type: "string", description: "e.g. 'hip mobility', 'desk posture reset'" },
        items: {
          type: "array",
          description: "Ordered items; each references a bank stretch by id",
          items: {
            type: "object",
            properties: { ...itemProps },
            required: ["stretchId"],
          },
        },
      },
      required: ["name", "items"],
    },
    run: (input: any) => JSON.stringify({ created: true, routine: createRoutine(input) }),
  },
  {
    name: "update_routine",
    description:
      "Update a routine by id: rename, edit description/focus, archive/unarchive it (archived: true/false — archive instead of deleting a routine that's been used), or pass `items` to REPLACE the full ordered item list. Confirm with the user before archiving or replacing items.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Routine id from list_routines" },
        name: { type: "string" },
        description: { type: "string" },
        focus: { type: "string" },
        archived: { type: "boolean", description: "true = archived, false = active" },
        items: {
          type: "array",
          description: "Full replacement item list (ordered); omit to leave items unchanged",
          items: {
            type: "object",
            properties: { ...itemProps },
            required: ["stretchId"],
          },
        },
      },
      required: ["id"],
    },
    run: (input: { id: number; [k: string]: unknown }) => {
      const { id, ...patch } = input;
      return JSON.stringify({ updated: true, routine: updateRoutine(parseId(id), patch) });
    },
  },
  {
    name: "delete_routine",
    description:
      "Permanently delete a routine and its items by id. Destructive — confirm with the user first, and prefer update_routine with archived: true for any routine that has logged sessions (past sessions keep their minutes but lose the routine link on delete).",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Routine id from list_routines" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      const id = parseId(input?.id);
      const routine = getRoutineWithItems(id);
      deleteRoutine(id);
      return JSON.stringify({ deleted: true, routine });
    },
  },
  // ---------------------------------------------------------------- sessions
  {
    name: "log_session",
    description:
      "Log a mobility session: date (default today), kind (stretch/yoga/posture/mixed, default stretch), optional routineId it followed, durationMinutes (required, > 0 and <= 600), feel 1-5, free-text qualitative report, and notes. ALWAYS ask the user for a brief post-session report ('How did it feel? Anything tight or painful?') and store it — pass it here, or attach it afterwards with update_session.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (default today)" },
        kind: { type: "string", enum: ["stretch", "yoga", "posture", "mixed"] },
        routineId: {
          type: ["number", "null"],
          description: "Routine followed (from list_routines), or null for freestyle",
        },
        durationMinutes: { type: "number", description: "Session length in minutes (required)" },
        feel: { type: ["number", "null"], description: "1 (rough) to 5 (great), or null" },
        report: {
          type: "string",
          description: "The user's qualitative report of how it went — always ask for one",
        },
        notes: { type: "string" },
      },
      required: ["durationMinutes"],
    },
    run: (input: any) => JSON.stringify({ logged: true, session: createSession(input) }),
  },
  {
    name: "update_session",
    description:
      "Update a logged session by id — most commonly to append the user's post-session qualitative report, or to fix date/kind/routineId/durationMinutes/feel/notes. Pass routineId null to detach the routine; feel null to clear it. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Session id" },
        date: { type: "string" },
        kind: { type: "string", enum: ["stretch", "yoga", "posture", "mixed"] },
        routineId: { type: ["number", "null"] },
        durationMinutes: { type: "number" },
        feel: { type: ["number", "null"] },
        report: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
    run: (input: { id: number; [k: string]: unknown }) => {
      const { id, ...patch } = input;
      return JSON.stringify({ updated: true, session: updateSession(parseId(id), patch) });
    },
  },
  {
    name: "delete_session",
    description:
      "Delete a logged session by id — use when the user double-logged or wants an entry gone. Destructive: confirm first, quoting the session's date, kind, and minutes back to them (ids come from get_today_summary or get_recent_reports).",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Session id to delete" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      const id = parseId(input?.id);
      const session = getSessionById(id);
      deleteSession(id);
      return JSON.stringify({ deleted: true, session });
    },
  },
  // ----------------------------------------------------------------- metrics
  {
    name: "list_metrics",
    description:
      "List the user's qualitative mobility metrics (id, name, description, direction, active), active first. Direction matters: higher_better (e.g. 'Hamstring flexibility') vs lower_better (e.g. 'Morning back stiffness'). Read this before creating metrics or logging assessments.",
    input_schema: { type: "object", properties: {} },
    run: () => JSON.stringify(listMetrics()),
  },
  {
    name: "create_metric",
    description:
      "Create a qualitative metric the user will rate 1-10 over time. Set direction carefully: higher_better when a rising score is good (flexibility, range of motion), lower_better when a falling score is good (stiffness, pain). Check list_metrics first to avoid duplicates.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'Hamstring flexibility'" },
        description: {
          type: "string",
          description: "What 1 and 10 mean for this metric, so ratings stay consistent",
        },
        direction: {
          type: "string",
          enum: ["higher_better", "lower_better"],
          description: "Default 'higher_better'",
        },
      },
      required: ["name"],
    },
    run: (input: any) => JSON.stringify({ created: true, metric: createMetric(input) }),
  },
  {
    name: "update_metric",
    description:
      "Update a metric by id: rename, edit description, change direction, or activate/deactivate it (active: true/false). Deactivate rather than delete when the user stops tracking something — history is kept. Confirm before changing direction (it flips trend interpretation).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Metric id from list_metrics" },
        name: { type: "string" },
        description: { type: "string" },
        direction: { type: "string", enum: ["higher_better", "lower_better"] },
        active: { type: "boolean" },
      },
      required: ["id"],
    },
    run: (input: { id: number; [k: string]: unknown }) => {
      const { id, ...patch } = input;
      return JSON.stringify({ updated: true, metric: updateMetric(parseId(id), patch) });
    },
  },
  {
    name: "delete_metric",
    description:
      "Permanently delete a metric by id. Destructive: ALL of its 1-10 assessments are deleted with it — confirm with the user first, and prefer update_metric with active: false when they just want to stop tracking it (history is kept).",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Metric id from list_metrics" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      const id = parseId(input?.id);
      const metric = getMetricById(id);
      deleteMetric(id);
      return JSON.stringify({ deleted: true, metric });
    },
  },
  {
    name: "log_assessment",
    description:
      "Rate a metric 1-10 for a date (default today). Remind the user of the metric's direction when asking for the score (for lower_better metrics a LOW score is good). Returns the stored assessment.",
    input_schema: {
      type: "object",
      properties: {
        metricId: { type: "number", description: "Metric id from list_metrics" },
        score: { type: "number", description: "Integer 1-10" },
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
        notes: { type: "string" },
      },
      required: ["metricId", "score"],
    },
    run: (input: any) => JSON.stringify({ logged: true, assessment: createAssessment(input) }),
  },
  {
    name: "delete_assessment",
    description:
      "Delete a single 1-10 assessment by id — the fix for a mis-logged rating (wrong score, wrong metric, or wrong date): delete it, then re-log with log_assessment. Find assessment ids in get_today_summary (assessmentsToday) or get_metric_trend (assessments). Confirm which rating first, quoting its metric, score, and date.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Assessment id to delete" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      const id = parseId(input?.id);
      const assessment = getAssessmentById(id);
      deleteAssessment(id);
      return JSON.stringify({ deleted: true, assessment });
    },
  },
  {
    name: "get_metric_trend",
    description:
      "A metric's assessments over the last N days (default 90) with stats (count, first, latest, min, max, avg) and a direction-aware trend judged from first vs latest score: 'improving', 'declining', or 'steady' (also 'steady' with fewer than 2 points). For lower_better metrics a falling score counts as improving. Use this before commenting on progress.",
    input_schema: {
      type: "object",
      properties: {
        metricId: { type: "number", description: "Metric id from list_metrics" },
        days: { type: "number", description: "Look-back window in days (default 90)" },
      },
      required: ["metricId"],
    },
    run: (input: { metricId: number; days?: number }) =>
      JSON.stringify(getMetricTrend(parseId(input?.metricId, "metricId"), input?.days ?? 90)),
  },
  // ----------------------------------------------------------------- reports
  {
    name: "get_recent_reports",
    description:
      "The most recent sessions that carry a non-empty qualitative report (default 10, newest first): date, kind, durationMinutes, feel, and the report text. Read these before giving mobility advice — they carry how sessions actually felt (tight areas, pain flags, wins).",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max sessions to return, 1-50 (default 10)" },
      },
    },
    run: (input: { limit?: number }) =>
      JSON.stringify(
        getRecentSessionReports(input?.limit ?? 10).map((s) => ({
          id: s.id,
          date: s.date,
          kind: s.kind,
          routineName: s.routineName ?? null,
          durationMinutes: s.durationMinutes,
          feel: s.feel,
          report: s.report,
        })),
      ),
  },
];

export const mobilityAgent: AgentDef = {
  name: "mobility",
  title: "Mobility Coach",
  persona: `You are the Mobility Coach — an expert flexibility, yoga, and posture coach inside the user's personal health app. You own the mobility segment: the stretch bank (stretches, yoga poses, posture drills with form cues), routines built from it, logged sessions (duration, feel 1-5, qualitative reports), and the user's own 1-10 metrics tracked over time (e.g. "Hamstring flexibility" where higher is better, "Morning back stiffness" where lower is better).

How you work:
- Every turn you receive an auto-injected <context> snapshot of today's mobility data plus your saved memory notes about the user. Use both before asking questions the data already answers.
- Read before you write: call list_stretches / list_routines / list_metrics / get_today_summary to see current state before creating or editing anything. Never create duplicate stretches or metrics.
- When the user asks for a routine, build it in ONE create_full_routine call — routine plus ordered items with hold times, reps, and per-side flags. Create any missing stretches first with real form cues in their instructions field, and quote those cues when coaching. On every pose you create, also fill the coaching fields the user reads on the pose card and in Follow mode: goal (what it's for), focus (what to focus on), feelWhere (where they should feel it), and choose the animKind that best matches the movement (reach_up, forward_fold, twist, lunge, hold, side_bend, cat_cow, neck_roll, or none).
- After logging anything, confirm concretely what was recorded ("Logged 20 min yoga, feel 4/5"). Confirm before destructive or sweeping changes (replacing a routine's items, archiving, deactivating a metric, any delete_* tool); prefer archiving routines and deactivating metrics over deleting. When something was mis-logged (duplicate stretch, double-logged session, wrong assessment score), delete it with the matching delete_* tool after the user confirms — for a wrong assessment, delete_assessment then re-log the correct score.
- ALWAYS ask for a brief post-session qualitative report ("How did it feel? Anything tight or painful?") and store it on the session via log_session or update_session — then actually use get_recent_reports to spot recurring tightness, pain flags, and wins.
- Metrics are direction-aware: interpret trends with get_metric_trend, where a falling lower_better score (less stiffness) is improvement. Encourage a quick 1-10 rating on a consistent schedule so the trend lines mean something.
- Memory: use save_memory for durable facts — injuries, chronically tight areas, posture complaints, mobility goals, preferred routines and times of day. Update or delete notes that become stale.

Tone: a calm, encouraging coach — concrete numbers, specific cues, clear next steps, no filler.`,
  tools,
  buildContext: () => {
    const date = todayStr();
    const s = getMobilityDaySummary(date);
    const stretchCount = listStretches().length;
    const activeRoutines = listRoutines(false).map((r) => ({
      id: r.id,
      name: r.name,
      focus: r.focus,
      items: r.items.length,
    }));
    return JSON.stringify({
      date,
      today: {
        totalMinutes: s.totalMinutes,
        byKind: s.byKind,
        sessions: s.sessions.map((x) => ({
          id: x.id,
          kind: x.kind,
          minutes: x.durationMinutes,
          feel: x.feel,
          routineName: x.routineName ?? null,
          report: x.report.length > 200 ? `${x.report.slice(0, 200)}…` : x.report,
        })),
        assessmentsToday: s.assessmentsToday.length,
      },
      metricsLatest: s.metricsLatest.slice(0, 8),
      ...(s.metricsLatest.length > 8 ? { moreMetrics: s.metricsLatest.length - 8 } : {}),
      bank: { stretches: stretchCount },
      activeRoutines: activeRoutines.slice(0, 8),
      ...(activeRoutines.length > 8 ? { moreRoutines: activeRoutines.length - 8 } : {}),
    });
  },
};
