import { useEffect, useMemo, useState } from "react";
import type { Exercise, ExerciseTrackingType, SessionSet } from "@shared/types";
import { workoutApi, type PlanFull, type PlanDayFull, type SessionFull, type WeekDaySchedule } from "../../api/workout";
import {
  buildMeasure,
  describeSetAuto,
  describeTarget,
  emptyDraft,
  milesFromMeters,
  TrackingInputs,
  type TrackDraft,
} from "./tracking";
import { FollowPlayer } from "./FollowPlayer";

function volumeOf(s: SessionFull): number {
  return s.sets.reduce((a, st) => a + st.reps * (st.weight ?? 0), 0);
}

/** First number of a rep-range prescription, e.g. "8-12" → "8"; "" for AMRAP etc. */
function firstRepOf(range: string | undefined | null): string {
  const m = (range ?? "").match(/\d+/);
  return m ? m[0] : "";
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
  // Plan day currently open in the guided Follow player.
  const [following, setFollowing] = useState<{ day: PlanDayFull; planName: string } | null>(null);

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

  /** Most recent logged set for an exercise (sessions arrive newest-first). */
  function lastSetFor(exId: number): SessionSet | null {
    for (const s of sessions) {
      for (let i = s.sets.length - 1; i >= 0; i--) {
        if (s.sets[i].exerciseId === exId) return s.sets[i];
      }
    }
    return null;
  }

  /** Pre-fill the set inputs from the most recent logged set for the exercise,
   *  falling back to the followed plan day's target. Effort (RPE) stays empty. */
  function prefillFor(exId: number): TrackDraft {
    const d = emptyDraft();
    const type = exById.get(exId)?.trackingType ?? "weight_reps";
    const last = lastSetFor(exId);
    const target = planDay?.exercises.find((pe) => pe.exerciseId === exId) ?? null;
    switch (type) {
      case "weight_reps":
      case "reps":
        if (last && last.reps > 0) d.reps = String(last.reps);
        else d.reps = firstRepOf(target?.reps);
        if (type === "weight_reps") {
          if (last) d.weight = last.weight != null ? String(last.weight) : "";
          else if (target?.targetWeight != null) d.weight = String(target.targetWeight);
        }
        break;
      case "time":
        if (last?.durationSeconds != null) d.timeMin = String(+(last.durationSeconds / 60).toFixed(2));
        else if (target?.targetSeconds != null) d.timeMin = String(+(target.targetSeconds / 60).toFixed(2));
        break;
      case "distance":
        if (last?.distanceM != null) d.distanceMi = milesFromMeters(last.distanceM).toFixed(2);
        else if (target?.targetDistanceM != null)
          d.distanceMi = milesFromMeters(target.targetDistanceM).toFixed(2);
        break;
      case "count":
        if (last?.count != null) d.count = String(last.count);
        else if (target?.targetCount != null) d.count = String(target.targetCount);
        break;
    }
    return d;
  }

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
        setDraft(prefillFor(first));
        return;
      }
    }
    if (!exerciseId) {
      const first = planDay?.exercises[0]?.exerciseId ?? exercises[0]?.id;
      if (first) {
        setExerciseId(String(first));
        setDraft(prefillFor(first));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function followDay(planDayId: number) {
    for (const p of plans) {
      const d = p.days.find((dd) => dd.id === planDayId);
      if (d) {
        setFollowing({ day: d, planName: p.name });
        return;
      }
    }
  }

  function changeExercise(id: string) {
    setExerciseId(id);
    // tracking type may differ — start from that exercise's last set / target
    setDraft(id ? prefillFor(Number(id)) : emptyDraft());
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
      // keep the just-logged values as the pre-fill for the next set; effort resets
      setDraft({ ...draft, rpe: "" });
    });

  return (
    <div className="card">
      <h3>Today&apos;s workout</h3>
      <div className="card-sub">At the gym now? Start here.</div>

      {!openSession ? (
        <div className="stack">
          {scheduled.length > 0 ? (
            <>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Scheduled today:</span>
              {scheduled.map((s) => (
                <div key={s.planDayId} className="row wrap">
                  <button
                    className="btn primary"
                    style={{ flex: "1 1 0", minWidth: 0 }}
                    disabled={busy}
                    onClick={() => start(s.planDayId)}
                  >
                    Start {s.planName} — {s.dayName}
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    title="Step through this day one exercise at a time"
                    onClick={() => followDay(s.planDayId)}
                  >
                    Follow
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p className="empty" style={{ padding: 0 }}>
              Nothing scheduled today — start any plan day or a blank session.
            </p>
          )}
          <div className="row wrap">
            <select
              className="input"
              style={{ flex: 2, minWidth: 160, maxWidth: "100%" }}
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
              style={{ flex: 2, minWidth: 120 }}
              placeholder="e.g. Arms"
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
                    <th>Effort</th>
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
              style={{ flex: 2, minWidth: 140, maxWidth: "100%" }}
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

      {following && (
        <FollowPlayer
          planName={following.planName}
          day={following.day}
          exercises={exercises}
          onClose={() => setFollowing(null)}
          onSaved={onChange}
        />
      )}
    </div>
  );
}

/** Sessions from the last 30 days, with per-session delete. */
export function RecentSessionsCard(props: { sessions: SessionFull[]; onChange: () => void }) {
  const { sessions, onChange } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = sessions.slice(0, 8);

  async function remove(s: SessionFull) {
    if (!window.confirm(`Delete session "${s.name}" (${s.date})?`)) return;
    setBusy(true);
    setError(null);
    try {
      await workoutApi.deleteSession(s.id);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Recent sessions</h3>
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
                    <button className="btn small danger" disabled={busy} onClick={() => remove(s)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
