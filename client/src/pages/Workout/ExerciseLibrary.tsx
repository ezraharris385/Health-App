import { Fragment, useState } from "react";
import type { Exercise, ExerciseTrackingType } from "@shared/types";
import { workoutApi } from "../../api/workout";
import { TRACKING_TYPES, trackingLabel } from "./tracking";

function truncate(s: string, n = 42): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Exercise library CRUD: name, muscle groups, equipment, tracking type,
 *  intensity + goal recommendations, form instructions, notes. */
export function ExerciseLibrary(props: { exercises: Exercise[]; onChange: () => void }) {
  const { exercises, onChange } = props;
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [muscles, setMuscles] = useState("");
  const [equipment, setEquipment] = useState("");
  const [trackingType, setTrackingType] = useState<ExerciseTrackingType>("weight_reps");
  const [intensityRec, setIntensityRec] = useState("");
  const [goalRec, setGoalRec] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setName("");
    setMuscles("");
    setEquipment("");
    setTrackingType("weight_reps");
    setIntensityRec("");
    setGoalRec("");
    setInstructions("");
    setNotes("");
  }

  function loadForEdit(ex: Exercise) {
    setEditingId(ex.id);
    setName(ex.name);
    setMuscles(ex.muscleGroups);
    setEquipment(ex.equipment);
    setTrackingType(ex.trackingType);
    setIntensityRec(ex.intensityRec);
    setGoalRec(ex.goalRec);
    setInstructions(ex.instructions);
    setNotes(ex.notes);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        muscleGroups: muscles,
        equipment,
        trackingType,
        intensityRec,
        goalRec,
        instructions,
        notes,
      };
      if (!input.name) throw new Error("Name is required");
      if (editingId !== null) await workoutApi.updateExercise(editingId, input);
      else await workoutApi.createExercise(input);
      resetForm();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(ex: Exercise) {
    if (
      !window.confirm(
        `Delete "${ex.name}"? This removes it from plans and deletes its logged sets.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await workoutApi.deleteExercise(ex.id);
      if (editingId === ex.id) resetForm();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {/* Heading wraps the button (not vice-versa) so the section stays a real
          <h3> in the a11y heading outline; the button is native and keeps its
          :focus-visible ring by resetting styles explicitly instead of all:unset.
          Disabled while an async CRUD is in flight so it can't be collapsed
          mid-operation (which would unmount the error message below). */}
      <h3 style={{ margin: 0 }}>
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
          }}
        >
          <span>
            {expanded ? "▾" : "▸"} Exercise library ({exercises.length})
          </span>
          <span className="row" style={{ gap: 8, alignItems: "center" }}>
            {editingId !== null && (
              <span className="chip" style={{ color: "var(--status-warning)" }}>
                editing
              </span>
            )}
            <span className="chip">{expanded ? "Hide" : "Show"}</span>
          </span>
        </button>
      </h3>

      {expanded && (
        <>
          <div className="stack" style={{ marginTop: 12 }}>
        <div className="row wrap">
          <input
            className="input"
            style={{ flex: 2, minWidth: 130 }}
            placeholder="Name (e.g. Barbell Bench Press)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            style={{ flex: 2, minWidth: 120 }}
            placeholder="Muscles (chest, triceps)"
            value={muscles}
            onChange={(e) => setMuscles(e.target.value)}
          />
          <input
            className="input"
            style={{ flex: 1, minWidth: 90 }}
            placeholder="Equipment"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          />
        </div>
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 150 }}>
            Tracking type
            <select
              className="input"
              value={trackingType}
              onChange={(e) => setTrackingType(e.target.value as ExerciseTrackingType)}
              title="How each performed set is measured"
            >
              {TRACKING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 2, minWidth: 160 }}>
            Intensity recommendation
            <input
              className="input"
              placeholder="e.g. RPE 8, ~2 reps in reserve"
              value={intensityRec}
              onChange={(e) => setIntensityRec(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: 2, minWidth: 160 }}>
            Goal recommendation
            <input
              className="input"
              placeholder="e.g. 3×8-12 for hypertrophy"
              value={goalRec}
              onChange={(e) => setGoalRec(e.target.value)}
            />
          </label>
        </div>
        <textarea
          className="input"
          rows={2}
          placeholder="Form instructions (setup, execution, common mistakes)"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="row">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="btn primary" disabled={busy} onClick={save}>
            {editingId !== null ? "Save" : "Add"}
          </button>
          {editingId !== null && (
            <button className="btn" disabled={busy} onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div style={{ marginTop: 12 }}>
        {exercises.length === 0 ? (
          <p className="empty">
            No exercises yet — add one above, or ask the coach for a plan and it will fill the
            library with tracking types, form cues, and recommendations.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Muscles</th>
                  <th>Tracks</th>
                  <th>Goal rec</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exercises.map((ex) => {
                  const open = detailId === ex.id;
                  return (
                    <Fragment key={ex.id}>
                      <tr>
                        <td>
                          <button
                            className="btn small"
                            style={{ border: "none", padding: "0 2px", fontWeight: 600 }}
                            onClick={() => setDetailId(open ? null : ex.id)}
                            title="Show recommendations & form"
                          >
                            {open ? "▾" : "▸"} {ex.name}
                          </button>
                        </td>
                        <td>{ex.muscleGroups || "—"}</td>
                        <td>
                          <span className="chip">{trackingLabel(ex.trackingType)}</span>
                        </td>
                        <td style={{ color: "var(--ink-2)", fontSize: 12 }}>
                          {ex.goalRec ? truncate(ex.goalRec) : "—"}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4 }}>
                            <button
                              className="btn small"
                              disabled={busy}
                              onClick={() => loadForEdit(ex)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn small danger"
                              disabled={busy}
                              onClick={() => remove(ex)}
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={5} style={{ fontSize: 12, color: "var(--ink-2)" }}>
                            <div className="stack" style={{ gap: 4 }}>
                              <div>
                                <strong>Tracking:</strong> {trackingLabel(ex.trackingType)}
                                {ex.equipment ? ` · ${ex.equipment}` : ""}
                              </div>
                              <div>
                                <strong>Intensity:</strong>{" "}
                                {ex.intensityRec || <em>no intensity recommendation yet</em>}
                              </div>
                              <div>
                                <strong>Goal:</strong>{" "}
                                {ex.goalRec || <em>no goal recommendation yet</em>}
                              </div>
                              <div>
                                <strong>Form:</strong>{" "}
                                {ex.instructions || (
                                  <em>no instructions yet — ask the coach to add cues.</em>
                                )}
                              </div>
                              {ex.notes && (
                                <div>
                                  <strong>Notes:</strong> {ex.notes}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </>
      )}
    </div>
  );
}
