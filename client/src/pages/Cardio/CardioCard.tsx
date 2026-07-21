import { Fragment, useState } from "react";
import type { CardioSession, CardioType } from "@shared/types";
import { todayStr } from "../../api/http";
import { cardioTotalSteps, workoutApi, type CardioInput } from "../../api/workout";
import { kmFromMi, miFromKm } from "../../units";
import { estimateDistanceKm, estimateSteps } from "@shared/data/summaries";
import {
  CARDIO_TYPES,
  CARDIO_TYPE_LABEL,
  cardioActivityName,
} from "./util";

type Mode = "distance" | "steps";

/** Parse a text input into a non-negative number, or null when blank/invalid. */
/** Format minutes-per-mile as "M:SS". */
function fmtPace(minPerMile: number): string {
  const m = Math.floor(minPerMile);
  const s = Math.round((minPerMile - m) * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Cardio log: an activity-type picker (9 types + free-text label for "other"),
 * two entry modes — distance/duration (miles in, km on the wire) and steps-only
 * (no distance/duration needed) — plus a detail-on-tap history table.
 */
export function CardioCard(props: { cardio: CardioSession[]; onChange: () => void }) {
  const { cardio, onChange } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("distance");
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<CardioType>("run");
  const [activityLabel, setActivityLabel] = useState("");
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState("5");
  const [stepsTotal, setStepsTotal] = useState("");
  const [stepsRun, setStepsRun] = useState("");
  const [stepsWalked, setStepsWalked] = useState("");
  const [report, setReport] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setMode("distance");
    setDate(todayStr());
    setType("run");
    setActivityLabel("");
    setDistance("");
    setDuration("");
    setIntensity("5");
    setStepsTotal("");
    setStepsRun("");
    setStepsWalked("");
    setReport("");
  }

  function loadForEdit(c: CardioSession) {
    // A distance that was auto-derived from steps is not a "real" distance —
    // reopen those steps-only sessions in steps mode so the run/walk split is
    // editable (and preserved on save) instead of being clobbered by a
    // distance-mode round-trip.
    const hasRealDistance = c.distanceKm > 0 && !c.distanceEstimated;
    const distanceMode = hasRealDistance || c.durationMinutes > 0;
    setEditingId(c.id);
    setMode(distanceMode ? "distance" : "steps");
    setDate(c.date);
    setType(c.type);
    setActivityLabel(c.activityLabel);
    // Stored canonical km -> shown/edited in miles. A derived distance is left
    // blank so switching into distance mode doesn't present an estimate as if
    // the user had entered it.
    setDistance(hasRealDistance ? String(Math.round(miFromKm(c.distanceKm) * 100) / 100) : "");
    setDuration(c.durationMinutes > 0 ? String(Math.round(c.durationMinutes)) : "");
    setIntensity(String(c.intensity));
    setStepsTotal(c.steps === null ? "" : String(c.steps));
    setStepsRun(c.estimatedStepsRun ? String(c.estimatedStepsRun) : "");
    setStepsWalked(c.estimatedStepsWalked ? String(c.estimatedStepsWalked) : "");
    setReport(c.report);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const base: CardioInput = {
        date,
        type,
        // Only 'other' carries a free-text label; clear it for known types.
        activityLabel: type === "other" ? activityLabel.trim() : "",
        intensity: Number(intensity),
        report,
      };
      let input: CardioInput;
      if (mode === "distance") {
        const mi = num(distance);
        const mins = num(duration);
        const stepsOverride = num(stepsTotal);
        if (mi === null && mins === null && stepsOverride === null) {
          throw new Error("Enter distance (mi), duration (min), or a step count.");
        }
        input = {
          ...base,
          // UI enters miles; convert to canonical km at the edge before sending.
          distanceKm: mi === null ? 0 : kmFromMi(mi),
          durationMinutes: mins === null ? 0 : mins,
          steps: stepsOverride,
        };
      } else {
        const run = num(stepsRun);
        const walked = num(stepsWalked);
        const total = num(stepsTotal);
        if ((run ?? 0) <= 0 && (walked ?? 0) <= 0 && (total ?? 0) <= 0) {
          throw new Error("Enter steps while running, steps while walking, or a total.");
        }
        // Steps-only: no distance/duration. Explicit split + optional total.
        input = {
          ...base,
          distanceKm: 0,
          durationMinutes: 0,
          stepsRun: run,
          stepsWalked: walked,
          steps: total,
        };
      }
      if (editingId !== null) {
        await workoutApi.updateCardio(editingId, input);
      } else {
        await workoutApi.createCardio(input);
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
      if (detailId === id) setDetailId(null);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const recent = cardio.slice(0, 8);

  // Live conversion previews so entered data populates the other fields:
  // steps → estimated miles (steps-only mode), and distance → estimated steps +
  // pace (distance mode). These mirror the auto-fill the store performs on save.
  const stepsPreviewKm = estimateDistanceKm(type, {
    stepsRun: num(stepsRun),
    stepsWalked: num(stepsWalked),
    total: num(stepsTotal),
  });
  const distanceHint =
    mode === "steps" && stepsPreviewKm > 0
      ? `≈ ${miFromKm(stepsPreviewKm).toFixed(2)} mi — auto-filled as your distance`
      : null;

  let stepsHint: string | null = null;
  if (mode === "distance") {
    const miVal = num(distance);
    const durVal = num(duration);
    const parts: string[] = [];
    if (miVal !== null && miVal > 0) {
      const est = estimateSteps(type, kmFromMi(miVal));
      const total = est.run + est.walked;
      if (total > 0) parts.push(`≈ ${total.toLocaleString()} steps`);
      if (durVal !== null && durVal > 0) parts.push(`${fmtPace(durVal / miVal)} /mi`);
    }
    stepsHint = parts.length > 0 ? parts.join(" · ") : null;
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Cardio log</h3>
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
          <label className="field" style={{ width: 120 }}>
            Activity
            <select className="input" value={type} onChange={(e) => setType(e.target.value as CardioType)}>
              {CARDIO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CARDIO_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {type === "other" && (
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              Activity label
              <input
                className="input"
                type="text"
                placeholder="e.g. Stair climber, swim"
                value={activityLabel}
                onChange={(e) => setActivityLabel(e.target.value)}
              />
            </label>
          )}
        </div>

        {/* Entry-mode toggle: distance/duration vs. steps only. */}
        <div className="row" role="tablist" style={{ gap: 6 }}>
          <button
            className={`btn small${mode === "distance" ? " primary" : ""}`}
            type="button"
            aria-pressed={mode === "distance"}
            onClick={() => setMode("distance")}
          >
            Distance &amp; duration
          </button>
          <button
            className={`btn small${mode === "steps" ? " primary" : ""}`}
            type="button"
            aria-pressed={mode === "steps"}
            onClick={() => setMode("steps")}
          >
            Steps only
          </button>
        </div>

        {mode === "distance" ? (
          <div className="row wrap">
            <label className="field" style={{ width: 96 }}>
              Distance (mi)
              <input
                className="input"
                type="number"
                step="0.1"
                min={0}
                placeholder={type === "other" ? "optional" : ""}
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
            </label>
            <label className="field" style={{ width: 96 }}>
              Duration (min)
              <input
                className="input"
                type="number"
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
            <label className="field" style={{ width: 96 }}>
              Intensity 1-10
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                value={intensity}
                onChange={(e) => setIntensity(e.target.value)}
              />
            </label>
            <label
              className="field"
              style={{ width: 120 }}
              title="Leave empty to auto-estimate from activity + distance"
            >
              Steps (override)
              <input
                className="input"
                type="number"
                min={0}
                placeholder="auto"
                value={stepsTotal}
                onChange={(e) => setStepsTotal(e.target.value)}
              />
            </label>
            {stepsHint && (
              <div className="chip" style={{ alignSelf: "center" }}>
                {stepsHint}
              </div>
            )}
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <p className="empty" style={{ margin: 0, textAlign: "left" }}>
              Log steps with their source — no distance or duration needed.
            </p>
            <div className="row wrap">
              <label className="field" style={{ width: 120 }}>
                Steps running
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={stepsRun}
                  onChange={(e) => setStepsRun(e.target.value)}
                />
              </label>
              <label className="field" style={{ width: 120 }}>
                Steps walking
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={stepsWalked}
                  onChange={(e) => setStepsWalked(e.target.value)}
                />
              </label>
              <label
                className="field"
                style={{ width: 120 }}
                title="Optional single total — overrides the split above for the headline count"
              >
                Total (optional)
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={stepsTotal}
                  onChange={(e) => setStepsTotal(e.target.value)}
                />
              </label>
              <label className="field" style={{ width: 96 }}>
                Intensity 1-10
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={intensity}
                  onChange={(e) => setIntensity(e.target.value)}
                />
              </label>
            </div>
            {distanceHint && (
              <div className="chip" style={{ alignSelf: "flex-start" }}>
                {distanceHint}
              </div>
            )}
          </div>
        )}

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
        <p className="empty">No cardio logged yet — log a run, walk, or steps above.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Activity</th>
              <th>mi</th>
              <th>min</th>
              <th>Steps</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => {
              const open = detailId === c.id;
              const steps = cardioTotalSteps(c);
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>{c.date}</td>
                    <td>
                      <button
                        className="btn small"
                        style={{ border: "none", padding: "0 2px", fontWeight: 600 }}
                        onClick={() => setDetailId(open ? null : c.id)}
                        title="Show details"
                      >
                        {open ? "▾" : "▸"} {cardioActivityName(c)}
                      </button>
                    </td>
                    <td>
                      {c.distanceKm > 0 ? (
                        miFromKm(c.distanceKm).toFixed(1)
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td>
                      {c.durationMinutes > 0 ? (
                        Math.round(c.durationMinutes)
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td title={c.steps !== null ? "Manually entered" : "Estimated from activity + distance"}>
                      {steps > 0 ? (
                        <>
                          {steps.toLocaleString()}{" "}
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>
                            {c.steps !== null ? "manual" : "est"}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
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
                  {open && (
                    <tr>
                      <td colSpan={6} style={{ fontSize: 12, color: "var(--ink-2)" }}>
                        <div className="stack" style={{ gap: 4 }}>
                          <div>
                            <strong>Activity:</strong> {cardioActivityName(c)}
                            {c.type === "other" ? "" : ` (${CARDIO_TYPE_LABEL[c.type]})`} ·{" "}
                            <strong>Intensity:</strong> {c.intensity}/10
                          </div>
                          <div>
                            <strong>Distance:</strong>{" "}
                            {c.distanceKm > 0 ? (
                              `${miFromKm(c.distanceKm).toFixed(2)} mi`
                            ) : (
                              <em>none logged</em>
                            )}{" "}
                            · <strong>Duration:</strong>{" "}
                            {c.durationMinutes > 0 ? `${Math.round(c.durationMinutes)} min` : <em>none</em>}
                          </div>
                          <div>
                            <strong>Steps:</strong>{" "}
                            {steps > 0 ? (
                              <>
                                {steps.toLocaleString()} ({c.steps !== null ? "manual" : "estimated"}) — run{" "}
                                {(c.estimatedStepsRun ?? 0).toLocaleString()} / walked{" "}
                                {(c.estimatedStepsWalked ?? 0).toLocaleString()}
                              </>
                            ) : (
                              <em>none</em>
                            )}
                          </div>
                          <div>
                            <strong>Report:</strong>{" "}
                            {c.report ? c.report : <em>no report — add one so the coach can weigh in.</em>}
                          </div>
                          {c.notes && (
                            <div>
                              <strong>Notes:</strong> {c.notes}
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
      )}
    </div>
  );
}
