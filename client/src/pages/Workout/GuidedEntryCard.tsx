import { useMemo, useRef, useState } from "react";
import type { Exercise, ExerciseTrackingType, PlanDayExercise } from "@shared/types";
import { todayStr } from "../../api/http";
import {
  workoutApi,
  type FullSessionEntryInput,
  type PlanDayFull,
  type PlanFull,
  type WeekDaySchedule,
} from "../../api/workout";
import {
  buildMeasure,
  describeTarget,
  draftHasValue,
  draftTouched,
  emptyDraft,
  milesFromMeters,
  parseSets,
  templatePlaceholders,
  TrackingInputs,
  trackingLabel,
  type TrackDraft,
} from "./tracking";

interface EntryRow {
  key: number;
  exerciseId: number;
  exerciseName: string;
  trackingType: ExerciseTrackingType;
  /** Plan-day prescription when the row came from the template; null for added rows. */
  template: PlanDayExercise | null;
  draft: TrackDraft;
}

/** Copy a row's plan-day targets into its draft (only fields the plan actually
 *  prescribes are written — an AMRAP rep range or missing weight stays blank). */
function draftFromTemplate(row: EntryRow): TrackDraft {
  const pe = row.template;
  if (!pe) return row.draft;
  const d = { ...row.draft };
  switch (row.trackingType) {
    case "weight_reps": {
      const m = (pe.reps ?? "").match(/\d+/);
      if (m) d.reps = m[0]; // first number of e.g. "8-12"
      if (pe.targetWeight != null) d.weight = String(pe.targetWeight);
      break;
    }
    case "reps": {
      const m = (pe.reps ?? "").match(/\d+/);
      if (m) d.reps = m[0];
      break;
    }
    case "time":
      if (pe.targetSeconds != null) d.timeMin = String(+(pe.targetSeconds / 60).toFixed(2));
      break;
    case "distance":
      if (pe.targetDistanceM != null) d.distanceMi = milesFromMeters(pe.targetDistanceM).toFixed(2);
      break;
    case "count":
      if (pe.targetCount != null) d.count = String(pe.targetCount);
      break;
  }
  return d;
}

/**
 * Guided after-the-fact entry: pick the plan day you did (today's scheduled
 * preselected) or an empty workout, fill in what you ACTUALLY did per exercise
 * (only the inputs that exercise's tracking type needs), and save everything as
 * one completed session on the chosen date. Blank rows = skipped. Collapsed
 * behind its header so live logging stays the page's primary path.
 */
export function GuidedEntryCard(props: {
  scheduled: WeekDaySchedule["scheduled"];
  plans: PlanFull[];
  exercises: Exercise[];
  onChange: () => void;
}) {
  const { scheduled, plans, exercises, onChange } = props;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const nextKey = useRef(1);

  const exById = useMemo(() => {
    const m = new Map<number, Exercise>();
    for (const e of exercises) m.set(e.id, e);
    return m;
  }, [exercises]);

  const dayById = useMemo(() => {
    const m = new Map<number, PlanDayFull>();
    for (const p of plans) for (const d of p.days) m.set(d.id, d);
    return m;
  }, [plans]);

  const defaultDayId = scheduled.length > 0 ? String(scheduled[0].planDayId) : "";

  function trackingOf(exerciseId: number): ExerciseTrackingType {
    return exById.get(exerciseId)?.trackingType ?? "weight_reps";
  }

  function rowsFromDay(id: string): EntryRow[] {
    const day = id === "" ? undefined : dayById.get(Number(id));
    if (!day) return [];
    return day.exercises.map((pe) => ({
      key: nextKey.current++,
      exerciseId: pe.exerciseId,
      exerciseName: pe.exerciseName ?? "Exercise",
      trackingType: trackingOf(pe.exerciseId),
      template: pe,
      draft: emptyDraft(String(pe.sets)),
    }));
  }

  const [date, setDate] = useState(() => todayStr());
  const [dayId, setDayId] = useState(defaultDayId);
  const [rows, setRows] = useState<EntryRow[]>(() => rowsFromDay(defaultDayId));
  const [pickId, setPickId] = useState("");

  function selectDay(id: string) {
    setDayId(id);
    setRows(rowsFromDay(id));
    setError(null);
    setSaved(null);
  }

  function patchDraft(index: number, patch: Partial<TrackDraft>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, draft: { ...r.draft, ...patch } } : r)));
    setSaved(null);
  }

  /** Fill every template row from its plan targets; blanking a row still skips it. */
  function fillFromPlan() {
    setRows(rows.map((r) => (r.template ? { ...r, draft: draftFromTemplate(r) } : r)));
    setSaved(null);
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
    setSaved(null);
  }

  function addRow() {
    const ex = exById.get(Number(pickId));
    if (!ex) return;
    setRows([
      ...rows,
      {
        key: nextKey.current++,
        exerciseId: ex.id,
        exerciseName: ex.name,
        trackingType: ex.trackingType,
        template: null,
        draft: emptyDraft("3"),
      },
    ]);
    setPickId("");
    setSaved(null);
  }

  const addable = useMemo(
    () => exercises.filter((ex) => !rows.some((r) => r.exerciseId === ex.id)),
    [exercises, rows],
  );
  const filledCount = rows.filter((r) => draftHasValue(r.trackingType, r.draft)).length;
  const hasTemplateRows = rows.some((r) => r.template !== null);

  async function save() {
    const entries: FullSessionEntryInput[] = [];
    for (const row of rows) {
      // A completely blank row = skipped, omit it silently. But a row the user
      // half-filled (e.g. a weight or intensity with no reps) is a mistake, not
      // a skip — fall through so buildMeasure validates it and surfaces the
      // error instead of silently dropping the exercise.
      if (!draftTouched(row.trackingType, row.draft)) continue;
      const setsRes = parseSets(row.draft.sets, row.exerciseName);
      if (!setsRes.ok) {
        setError(setsRes.error);
        return;
      }
      const mRes = buildMeasure(row.trackingType, row.draft, row.exerciseName);
      if (!mRes.ok) {
        setError(mRes.error);
        return;
      }
      entries.push({ exerciseId: row.exerciseId, sets: setsRes.sets, ...mRes.measure });
    }
    if (entries.length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await workoutApi.sessionFull({
        date: date || undefined,
        planDayId: dayId === "" ? null : Number(dayId),
        entries,
      });
      setSaved(`Logged ${entries.length} exercise${entries.length === 1 ? "" : "s"} — nice work.`);
      setDate(todayStr());
      setDayId(defaultDayId);
      setRows(rowsFromDay(defaultDayId));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {/* Heading wraps the toggle so the section stays a real <h3> in the a11y
          outline; the button is native and keeps its :focus-visible ring. */}
      <h3 style={{ margin: "0 0 4px" }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          disabled={busy}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            margin: 0,
            font: "inherit",
            color: "inherit",
            textAlign: "left",
            boxSizing: "border-box",
            cursor: "pointer",
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>
            {expanded ? "▾" : "▸"} Log a past workout
          </span>
          <span className="chip">{expanded ? "Hide" : "Show"}</span>
        </button>
      </h3>
      <div className="card-sub" style={{ marginTop: 0, marginBottom: expanded ? 12 : 0 }}>
        Already done (or another day)? Enter it here.
      </div>

      {expanded && (
        <div className="stack">
          <div className="row wrap">
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              Date
              <input
                className="input"
                type="date"
                max={todayStr()}
                value={date}
                disabled={busy}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSaved(null);
                }}
              />
            </label>
            <label className="field" style={{ flex: 2, minWidth: 210, maxWidth: "100%" }}>
              Which workout was it?
              <select
                className="input"
                style={{ maxWidth: "100%" }}
                value={dayId}
                disabled={busy}
                onChange={(e) => selectDay(e.target.value)}
              >
                <option value="">Empty workout (no template)</option>
                {plans.flatMap((p) =>
                  p.days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {p.name} — {d.name}
                      {String(d.id) === defaultDayId ? " (today)" : ""}
                    </option>
                  )),
                )}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <p className="empty" style={{ padding: 0 }}>
              No exercises yet — pick a plan day above or add exercises below.
            </p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row between wrap" style={{ gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Sets · Reps · Weight (lb) · Effort · Time (min)
                </span>
                {hasTemplateRows && (
                  <button
                    className="btn small"
                    disabled={busy}
                    title="Pre-fill each row with its plan targets — clear a row to skip it"
                    onClick={fillFromPlan}
                  >
                    Fill from plan
                  </button>
                )}
              </div>
              {rows.map((row, i) => (
                <div key={row.key} className="stack" style={{ gap: 4 }}>
                  <div className="row between wrap">
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{row.exerciseName}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {row.template
                        ? describeTarget(row.template, row.trackingType)
                        : trackingLabel(row.trackingType)}
                    </span>
                  </div>
                  <div className="row wrap" style={{ alignItems: "flex-end", gap: 6 }}>
                    <TrackingInputs
                      type={row.trackingType}
                      draft={row.draft}
                      onChange={(patch) => patchDraft(i, patch)}
                      placeholders={
                        row.template
                          ? templatePlaceholders(row.template, row.trackingType)
                          : undefined
                      }
                      showSets
                      showRpe
                      disabled={busy}
                    />
                    <button
                      className="btn small danger"
                      disabled={busy}
                      title="Remove this row"
                      onClick={() => removeRow(i)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row wrap">
            <select
              className="input"
              style={{ flex: 1, minWidth: 160, maxWidth: "100%" }}
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              <option value="">Add an exercise…</option>
              {addable.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
            <button className="btn small" disabled={busy || pickId === ""} onClick={addRow}>
              Add
            </button>
          </div>

          <div className="row wrap">
            <button className="btn primary" disabled={busy || filledCount === 0} onClick={save}>
              Save workout{filledCount > 0 ? ` (${filledCount})` : ""}
            </button>
            {filledCount === 0 && rows.length > 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Fill in what you did on at least one row.
              </span>
            )}
          </div>
        </div>
      )}
      {saved && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--good-text)" }}>{saved}</p>
      )}
      {error && expanded && <p className="error-text">{error}</p>}
    </div>
  );
}
