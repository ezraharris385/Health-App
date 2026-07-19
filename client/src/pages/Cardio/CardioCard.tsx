import { useState } from "react";
import type { CardioSession, CardioType } from "@shared/types";
import { todayStr } from "../../api/http";
import { cardioTotalSteps, workoutApi } from "../../api/workout";

const TYPES: CardioType[] = ["run", "jog", "walk", "interval"];

/** Cardio log: form (auto step estimation with manual override) + recent history. */
export function CardioCard(props: { cardio: CardioSession[]; onChange: () => void }) {
  const { cardio, onChange } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<CardioType>("run");
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState("5");
  const [stepsOverride, setStepsOverride] = useState("");
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setDate(todayStr());
    setType("run");
    setDistance("");
    setDuration("");
    setIntensity("5");
    setStepsOverride("");
    setReport("");
  }

  function loadForEdit(c: CardioSession) {
    setEditingId(c.id);
    setDate(c.date);
    setType(c.type);
    setDistance(String(c.distanceKm));
    setDuration(String(c.durationMinutes));
    setIntensity(String(c.intensity));
    setStepsOverride(c.steps === null ? "" : String(c.steps));
    setReport(c.report);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input = {
        date,
        type,
        distanceKm: Number(distance),
        durationMinutes: Number(duration),
        intensity: Number(intensity),
        steps: stepsOverride === "" ? null : Number(stepsOverride),
        report,
      };
      if (!Number.isFinite(input.distanceKm) || distance === "") {
        throw new Error("Distance (km) is required");
      }
      if (!Number.isFinite(input.durationMinutes) || duration === "") {
        throw new Error("Duration (min) is required");
      }
      if (editingId !== null) {
        await workoutApi.updateCardio(editingId, input);
      } else {
        await workoutApi.createCardio({ ...input, steps: input.steps ?? undefined });
      }
      resetForm();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this cardio session?")) return;
    setBusy(true);
    try {
      await workoutApi.deleteCardio(id);
      if (editingId === id) resetForm();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const recent = cardio.slice(0, 8);

  return (
    <div className="card">
      <div className="row between">
        <h3>Cardio — runs &amp; walks</h3>
        {editingId !== null && (
          <span className="chip" style={{ color: "var(--status-warning)" }}>
            editing #{editingId}
          </span>
        )}
      </div>
      <div className="stack">
        <div className="row wrap">
          <label className="field" style={{ width: 130 }}>
            Date
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field" style={{ width: 100 }}>
            Type
            <select className="input" value={type} onChange={(e) => setType(e.target.value as CardioType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ width: 96 }}>
            Distance (km)
            <input className="input" type="number" step="0.1" value={distance} onChange={(e) => setDistance(e.target.value)} />
          </label>
          <label className="field" style={{ width: 96 }}>
            Duration (min)
            <input className="input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="field" style={{ width: 96 }}>
            Intensity 1-10
            <input className="input" type="number" min={1} max={10} value={intensity} onChange={(e) => setIntensity(e.target.value)} />
          </label>
          <label className="field" style={{ width: 120 }} title="Leave empty to auto-estimate from type + distance">
            Steps (override)
            <input
              className="input"
              type="number"
              placeholder="auto"
              value={stepsOverride}
              onChange={(e) => setStepsOverride(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          How did it go? (report — the coach uses this for analysis)
          <textarea
            className="input"
            rows={2}
            placeholder="e.g. Felt strong first 3k, right calf tightened up on the hill…"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={save}>
            {editingId !== null ? "Save changes" : "Log cardio"}
          </button>
          {editingId !== null && (
            <button className="btn" disabled={busy} onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>
        Recent cardio
      </div>
      {recent.length === 0 ? (
        <p className="empty">No cardio logged yet — log a run or walk above.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>km</th>
              <th>min</th>
              <th>Int.</th>
              <th>Steps</th>
              <th>Report</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id}>
                <td>{c.date}</td>
                <td>{c.type}</td>
                <td>{Math.round(c.distanceKm * 100) / 100}</td>
                <td>{Math.round(c.durationMinutes)}</td>
                <td>{c.intensity}</td>
                <td title={c.steps !== null ? "Manually entered" : "Estimated from type + distance"}>
                  {cardioTotalSteps(c).toLocaleString()}{" "}
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    {c.steps !== null ? "manual" : "est"}
                  </span>
                </td>
                <td
                  title={c.report}
                  style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {c.report ? c.report : <span style={{ color: "var(--muted)" }}>—</span>}
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn small" disabled={busy} onClick={() => loadForEdit(c)}>
                      Edit
                    </button>
                    <button className="btn small danger" disabled={busy} onClick={() => remove(c.id)}>
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
