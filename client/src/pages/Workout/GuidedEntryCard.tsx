import { useMemo, useRef, useState } from "react";
import type { Exercise } from "@shared/types";
import {
  workoutApi,
  type FullSessionEntryInput,
  type PlanDayFull,
  type PlanFull,
  type WeekDaySchedule,
} from "../../api/workout";

interface EntryRow {
  key: number;
  exerciseId: number;
  exerciseName: string;
  /** Plan-day prescription when the row came from the template; null for added rows. */
  template: { sets: number; reps: string; targetWeight: number | null } | null;
  sets: string;
  reps: string;
  weight: string;
  rpe: string;
  /** Timed work in minutes (converted ×60 to durationSeconds on save). */
  timeMin: string;
}

function templateHint(t: NonNullable<EntryRow["template"]>): string {
  return `${t.sets}×${t.reps}${t.targetWeight != null ? ` @ ${t.targetWeight} lb` : ""}`;
}

const rowFilled = (r: EntryRow) => r.reps.trim() !== "" || r.timeMin.trim() !== "";

/**
 * Guided after-the-fact entry: pick the plan day you did (today's scheduled
 * preselected) or an empty workout, fill in what you ACTUALLY did per exercise,
 * and save everything as one completed session. Blank rows = skipped.
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

  const dayById = useMemo(() => {
    const m = new Map<number, PlanDayFull>();
    for (const p of plans) for (const d of p.days) m.set(d.id, d);
    return m;
  }, [plans]);

  const defaultDayId = scheduled.length > 0 ? String(scheduled[0].planDayId) : "";

  function rowsFromDay(id: string): EntryRow[] {
    const day = id === "" ? undefined : dayById.get(Number(id));
    if (!day) return [];
    return day.exercises.map((pe) => ({
      key: nextKey.current++,
      exerciseId: pe.exerciseId,
      exerciseName: pe.exerciseName ?? "Exercise",
      template: { sets: pe.sets, reps: pe.reps, targetWeight: pe.targetWeight },
      sets: String(pe.sets),
      reps: "",
      weight: "",
      rpe: "",
      timeMin: "",
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

  function updateRow(index: number, patch: Partial<EntryRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(null);
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
    setSaved(null);
  }

  function addRow() {
    const ex = exercises.find((e) => String(e.id) === pickId);
    if (!ex) return;
    setRows([
      ...rows,
      {
        key: nextKey.current++,
        exerciseId: ex.id,
        exerciseName: ex.name,
        template: null,
        sets: "3",
        reps: "",
        weight: "",
        rpe: "",
        timeMin: "",
      },
    ]);
    setPickId("");
    setSaved(null);
  }

  const addable = useMemo(
    () => exercises.filter((ex) => !rows.some((r) => r.exerciseId === ex.id)),
    [exercises, rows],
  );
  const filledCount = rows.filter(rowFilled).length;

  async function save() {
    const entries: FullSessionEntryInput[] = [];
    for (const row of rows) {
      if (!rowFilled(row)) continue; // blank = didn't do it
      const sets = row.sets.trim() === "" ? 1 : Number(row.sets);
      if (!Number.isInteger(sets) || sets < 1 || sets > 20) {
        setError(`${row.exerciseName}: sets must be a whole number 1-20`);
        return;
      }
      const reps = row.reps.trim() === "" ? 0 : Number(row.reps);
      if (!Number.isInteger(reps) || reps < 0 || reps > 1000) {
        setError(`${row.exerciseName}: reps must be a whole number`);
        return;
      }
      const weight = row.weight.trim() === "" ? null : Number(row.weight);
      if (weight !== null && (!Number.isFinite(weight) || weight < 0)) {
        setError(`${row.exerciseName}: weight must be 0 or more`);
        return;
      }
      const timeMin = row.timeMin.trim() === "" ? null : Number(row.timeMin);
      // Validate the converted seconds (the store's real bound is 1..21600s).
      const durationSeconds = timeMin === null ? null : Math.round(timeMin * 60);
      if (
        durationSeconds !== null &&
        (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 21600)
      ) {
        setError(`${row.exerciseName}: time must be between 0.01 and 360 minutes`);
        return;
      }
      if (reps === 0 && durationSeconds === null) {
        setError(`${row.exerciseName}: reps 0 needs a time — enter reps, or minutes for timed work`);
        return;
      }
      entries.push({
        exerciseId: row.exerciseId,
        sets,
        reps,
        weight,
        rpe: row.rpe === "" ? null : Number(row.rpe),
        durationSeconds,
      });
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
          <select
            className="input"
            value={dayId}
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
                    {row.template ? templateHint(row.template) : "extra"}
                  </span>
                </div>
                <div className="row wrap">
                  <input
                    className="input"
                    style={{ width: 58 }}
                    type="number"
                    min={1}
                    max={20}
                    title="Sets performed"
                    value={row.sets}
                    onChange={(e) => updateRow(i, { sets: e.target.value })}
                  />
                  <input
                    className="input"
                    style={{ width: 70 }}
                    type="number"
                    title="Reps per set — leave blank if you skipped this exercise"
                    placeholder={row.template?.reps ?? "reps"}
                    value={row.reps}
                    onChange={(e) => updateRow(i, { reps: e.target.value })}
                  />
                  <input
                    className="input"
                    style={{ width: 76 }}
                    type="number"
                    title="Weight used (lb)"
                    placeholder={row.template?.targetWeight != null ? String(row.template.targetWeight) : "lb"}
                    value={row.weight}
                    onChange={(e) => updateRow(i, { weight: e.target.value })}
                  />
                  <select
                    className="input"
                    style={{ width: 64 }}
                    title="Intensity (RPE 1-10)"
                    value={row.rpe}
                    onChange={(e) => updateRow(i, { rpe: e.target.value })}
                  >
                    <option value="">—</option>
                    {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    style={{ width: 70 }}
                    type="number"
                    step={0.5}
                    min={0.5}
                    title="Timed work per set, in minutes (e.g. planks)"
                    placeholder="min"
                    value={row.timeMin}
                    onChange={(e) => updateRow(i, { timeMin: e.target.value })}
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
              Enter reps or time on at least one row.
            </span>
          )}
        </div>
        {saved && <p style={{ margin: 0, fontSize: 13, color: "var(--good-text)" }}>{saved}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
