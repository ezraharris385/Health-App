import { useMemo, useRef, useState } from "react";
import type { Exercise, ExerciseTrackingType, PlanDayExercise } from "@shared/types";
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

/**
 * Guided after-the-fact entry: pick the plan day you did (today's scheduled
 * preselected) or an empty workout, fill in what you ACTUALLY did per exercise
 * (only the inputs that exercise's tracking type needs), and save everything as
 * one completed session. Blank rows = skipped.
 */
export function GuidedEntryCard(props: {
  scheduled: WeekDaySchedule["scheduled"];
  plans: PlanFull[];
  exercises: Exercise[];
  onChange: () => void;
}) {
  const { scheduled, plans, exercises, onChange } = props;
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
        planDayId: dayId === "" ? null : Number(dayId),
        entries,
      });
      setSaved(`Logged ${entries.length} exercise${entries.length === 1 ? "" : "s"} — nice work.`);
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
      <h3>Log a full workout</h3>
      <div className="card-sub">
        Record what you actually did in one go — leave a row blank if you skipped it.
      </div>
      <div className="stack">
        <label className="field">
          Which workout was it?
          <select className="input" value={dayId} onChange={(e) => selectDay(e.target.value)}>
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

        {rows.length === 0 ? (
          <p className="empty" style={{ padding: 0 }}>
            No exercises yet — pick a plan day above or add exercises below.
          </p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
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
                <div className="row wrap" style={{ alignItems: "flex-end" }}>
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
            style={{ flex: 1, minWidth: 160 }}
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

        <div className="row">
          <button className="btn primary" disabled={busy || filledCount === 0} onClick={save}>
            Save workout{filledCount > 0 ? ` (${filledCount})` : ""}
          </button>
          {filledCount === 0 && rows.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Fill in what you did on at least one row.
            </span>
          )}
        </div>
        {saved && <p style={{ margin: 0, fontSize: 13, color: "var(--good-text)" }}>{saved}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
