import { Fragment, useState } from "react";
import type { Exercise } from "@shared/types";
import { workoutApi } from "../../api/workout";

/** Exercise library CRUD: name, muscle groups, equipment, form instructions, notes. */
export function ExerciseLibrary(props: { exercises: Exercise[]; onChange: () => void }) {
  const { exercises, onChange } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [muscles, setMuscles] = useState("");
  const [equipment, setEquipment] = useState("");
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
    setInstructions("");
    setNotes("");
  }

  function loadForEdit(ex: Exercise) {
    setEditingId(ex.id);
    setName(ex.name);
    setMuscles(ex.muscleGroups);
    setEquipment(ex.equipment);
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
      <div className="row between">
        <h3>Exercise library</h3>
        {editingId !== null && (
          <span className="chip" style={{ color: "var(--status-warning)" }}>
            editing
          </span>
        )}
      </div>

      <div className="stack">
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
            library with form instructions.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Muscles</th>
                <th>Equipment</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {exercises.map((ex) => (
                <Fragment key={ex.id}>
                  <tr>
                    <td>
                      <button
                        className="btn small"
                        style={{ border: "none", padding: "0 2px", fontWeight: 600 }}
                        onClick={() => setDetailId(detailId === ex.id ? null : ex.id)}
                        title="Show form instructions"
                      >
                        {detailId === ex.id ? "▾" : "▸"} {ex.name}
                      </button>
                    </td>
                    <td>{ex.muscleGroups || "—"}</td>
                    <td>{ex.equipment || "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn small" disabled={busy} onClick={() => loadForEdit(ex)}>
                          Edit
                        </button>
                        <button className="btn small danger" disabled={busy} onClick={() => remove(ex)}>
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                  {detailId === ex.id && (
                    <tr>
                      <td colSpan={4} style={{ fontSize: 12, color: "var(--ink-2)" }}>
                        <strong>Form:</strong>{" "}
                        {ex.instructions || <em>No instructions yet — ask the coach to add cues.</em>}
                        {ex.notes && (
                          <>
                            <br />
                            <strong>Notes:</strong> {ex.notes}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
