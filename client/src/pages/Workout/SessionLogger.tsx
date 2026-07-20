import { useEffect, useMemo, useState } from "react";
import type { Exercise, ExerciseTrackingType } from "@shared/types";
import { workoutApi, type PlanFull, type SessionFull, type WeekDaySchedule } from "../../api/workout";
import {
  buildMeasure,
  describeSetAuto,
  describeTarget,
  emptyDraft,
  TrackingInputs,
  type TrackDraft,
} from "./tracking";

function volumeOf(s: SessionFull): number {
  return s.sets.reduce((a, st) => a + st.reps * (st.weight ?? 0), 0);
}

/** Today's workout: start a session (from a scheduled plan day or blank) and log
 *  sets with the inputs each exercise's tracking type needs. */
export function SessionLogger(props: {
  today: string;
  scheduled: WeekDaySchedule["scheduled"];
  sessions: SessionFull[];
  exercises: Exercise[];
  plans: PlanFull[];
  onChange: () => void;
}) {
  const { today, scheduled, sessions, exercises, plans, onChange } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exById = useMemo(() => {
    const m = new Map<number, Exercise>();
    for (const e of exercises) m.set(e.id, e);
    return m;
  }, [exercises]);

  const openSession = useMemo(
    () => sessions.find((s) => s.date === today && !s.completedAt),
    [sessions, today],
  );

  // start form
  const [startPlanDayId, setStartPlanDayId] = useState<string>("");
  const [blankName, setBlankName] = useState("");

  // set form
  const [exerciseId, setExerciseId] = useState<string>("");
  const [draft, setDraft] = useState<TrackDraft>(() => emptyDraft());

  const selectedType: ExerciseTrackingType =
    exById.get(Number(exerciseId))?.trackingType ?? "weight_reps";

  const planDay = useMemo(() => {
    if (!openSession?.planDayId) return null;
    for (const p of plans) {
      const d = p.days.find((dd) => dd.id === openSession.planDayId);
      if (d) return d;
    }
    return null;
  }, [openSession, plans]);

  // Preselect the first exercise of the followed plan day (or first library exercise).
  // Re-run once per newly started session (keyed on session id) so a plan day's
  // first exercise wins over the mount-time library default, without stomping
  // manual dropdown choices mid-session.
  const [preselectedSessionId, setPreselectedSessionId] = useState<number | null>(null);
  useEffect(() => {
    const sid = openSession?.id ?? null;
    if (sid !== null && sid !== preselectedSessionId) {
      setPreselectedSessionId(sid);
      const first = planDay?.exercises[0]?.exerciseId ?? exercises[0]?.id;
      if (first) {
        setExerciseId(String(first));
        return;
      }
    }
    if (!exerciseId) {
      const first = planDay?.exercises[0]?.exerciseId ?? exercises[0]?.id;
      if (first) setExerciseId(String(first));
    }
  }, [openSession, planDay, exercises, exerciseId, preselectedSessionId]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const start = (planDayId?: number, name?: string) =>
    act(() => workoutApi.createSession({ planDayId, name }));

  function changeExercise(id: string) {
    setExerciseId(id);
    setDraft(emptyDraft()); // tracking type may differ — start clean
  }

  const addSet = () =>
    act(async () => {
      if (!openSession) return;
      const exId = Number(exerciseId);
      if (!exId) throw new Error("Pick an exercise");
      const ex = exById.get(exId);
      const res = buildMeasure(ex?.trackingType ?? "weight_reps", draft, ex?.name ?? "Exercise");
      if (!res.ok) throw new Error(res.error);
      await workoutApi.addSet(openSession.id, { exerciseId: exId, ...res.measure });
      setDraft(emptyDraft());
    });

  const recent = sessions.slice(0, 8);

  return (
    <div className="card">
      <h3>Today&apos;s workout</h3>

      {!openSession ? (
        <div className="stack">
          {scheduled.length > 0 ? (
            <>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Scheduled today:</span>
              <div className="row wrap">
                {scheduled.map((s) => (
                  <button
                    key={s.planDayId}
                    className="btn primary"
                    disabled={busy}
                    onClick={() => start(s.planDayId)}
                  >
                    Start {s.planName} — {s.dayName}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="empty" style={{ padding: 0 }}>
              Nothing scheduled today — start any plan day or a blank session.
            </p>
          )}
          <div className="row wrap">
            <select
              className="input"
              style={{ flex: 2, minWidth: 160 }}
              value={startPlanDayId}
              onChange={(e) => setStartPlanDayId(e.target.value)}
            >
              <option value="">Pick a plan day…</option>
              {plans.flatMap((p) =>
                p.days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {p.name} — {d.name}
                  </option>
                )),
              )}
            </select>
            <button
              className="btn"
              disabled={busy || !startPlanDayId}
              onClick={() => start(Number(startPlanDayId))}
            >
              Start
            </button>
          </div>
          <div className="row wrap">
            <input
              className="input"
              style={{ flex: 2, minWidth: 160 }}
              placeholder="Blank session name (e.g. Arms)"
              value={blankName}
              onChange={(e) => setBlankName(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy}
              onClick={() => start(undefined, blankName.trim() || "Workout")}
            >
              Start blank
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="row between wrap">
            <strong>{openSession.name}</strong>
            <div className="row">
              <button
                className="btn small primary"
                disabled={busy}
                onClick={() => act(() => workoutApi.completeSession(openSession.id))}
              >
                Complete session
              </button>
              <button
                className="btn small danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this session and its sets?")) {
                    act(() => workoutApi.deleteSession(openSession.id));
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>

          {planDay && planDay.exercises.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {planDay.exercises.map((pe) => (
                <span key={pe.id} className="chip" title={pe.notes}>
                  {pe.exerciseName}:{" "}
                  {describeTarget(pe, exById.get(pe.exerciseId)?.trackingType ?? "weight_reps")}
                </span>
              ))}
            </div>
          )}

          {openSession.sets.length === 0 ? (
            <p className="empty" style={{ padding: 0 }}>
              No sets logged yet — add your first set below.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Exercise</th>
                    <th>Set</th>
                    <th>Result</th>
                    <th>RPE</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {openSession.sets.map((st) => (
                    <tr key={st.id}>
                      <td>{st.exerciseName}</td>
                      <td>{st.setNumber}</td>
                      <td>{describeSetAuto(st)}</td>
                      <td>{st.rpe ?? "—"}</td>
                      <td>
                        <button
                          className="btn small danger"
                          disabled={busy}
                          onClick={() => act(() => workoutApi.deleteSet(st.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <select
              className="input"
              style={{ flex: 2, minWidth: 140 }}
              value={exerciseId}
              onChange={(e) => changeExercise(e.target.value)}
            >
              <option value="">Exercise…</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
            <TrackingInputs
              type={selectedType}
              draft={draft}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
              showRpe
              disabled={busy || !exerciseId}
            />
            <button className="btn primary" disabled={busy} onClick={addSet}>
              Add set
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="section-title" style={{ marginTop: 18 }}>
        Recent sessions
      </div>
      {recent.length === 0 ? (
        <p className="empty">No sessions in the last 30 days.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Session</th>
                <th>Sets</th>
                <th>Volume</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td>{s.date}</td>
                  <td>{s.name || "Workout"}</td>
                  <td>{s.sets.length}</td>
                  <td>{Math.round(volumeOf(s)).toLocaleString()}</td>
                  <td>
                    <span
                      className="chip"
                      style={{
                        color: s.completedAt ? "var(--good-text)" : "var(--status-warning)",
                      }}
                    >
                      {s.completedAt ? "done" : "open"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete session "${s.name}" (${s.date})?`)) {
                          act(() => workoutApi.deleteSession(s.id));
                        }
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
