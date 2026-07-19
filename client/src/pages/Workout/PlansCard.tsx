import { useState } from "react";
import type { Exercise } from "@shared/types";
import { DOW_LONG, workoutApi, type PlanDayFull, type PlanFull } from "../../api/workout";

/** Plan manager: weekly-scheduled days with ordered exercises. */
export function PlansCard(props: {
  plans: PlanFull[];
  exercises: Exercise[];
  onChange: () => void;
}) {
  const { plans, exercises, onChange } = props;
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="card">
      <h3>Plans</h3>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ flex: 2, minWidth: 140 }}
          placeholder="New plan name (e.g. Push Pull Legs)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 100 }}
          placeholder="Goal (e.g. strength)"
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={busy || !newName.trim()}
          onClick={() =>
            act(async () => {
              const p = await workoutApi.createPlan({ name: newName.trim(), goal: newGoal.trim() });
              setNewName("");
              setNewGoal("");
              setExpanded(p.id);
            })
          }
        >
          Create
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}

      {plans.length === 0 ? (
        <p className="empty">
          No plans yet. Create one above — or ask the Workout Coach to build a full program for you.
        </p>
      ) : (
        <div className="stack">
          {plans.map((p) => (
            <PlanView
              key={p.id}
              plan={p}
              exercises={exercises}
              expanded={expanded === p.id}
              busy={busy}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              act={act}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanView(props: {
  plan: PlanFull;
  exercises: Exercise[];
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { plan, exercises, expanded, busy, onToggle, act } = props;
  const [dayName, setDayName] = useState("");
  const [dayDow, setDayDow] = useState("");

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
      <div className="row between wrap">
        <button
          className="btn small"
          style={{ border: "none", padding: "2px 4px", fontWeight: 700 }}
          onClick={onToggle}
        >
          {expanded ? "▾" : "▸"} {plan.name}
        </button>
        <div className="row" style={{ gap: 6 }}>
          {plan.goal && <span className="chip">{plan.goal}</span>}
          <span className="chip">{plan.days.length} days</span>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => act(() => workoutApi.updatePlan(plan.id, { archived: true }))}
            title="Archived plans drop out of the weekly schedule"
          >
            Archive
          </button>
          <button
            className="btn small danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete plan "${plan.name}" and all its days?`)) {
                act(() => workoutApi.deletePlan(plan.id));
              }
            }}
          >
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="stack" style={{ marginTop: 10 }}>
          {plan.description && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-2)" }}>{plan.description}</p>
          )}
          {plan.days.length === 0 && (
            <p className="empty" style={{ padding: 0 }}>
              No days yet — add one below.
            </p>
          )}
          {plan.days.map((d) => (
            <DayView key={d.id} day={d} exercises={exercises} busy={busy} act={act} />
          ))}
          <div className="row wrap">
            <input
              className="input"
              style={{ flex: 2, minWidth: 120 }}
              placeholder="Day name (e.g. Push A)"
              value={dayName}
              onChange={(e) => setDayName(e.target.value)}
            />
            <select
              className="input"
              style={{ width: 140 }}
              value={dayDow}
              onChange={(e) => setDayDow(e.target.value)}
            >
              <option value="">Unscheduled</option>
              {DOW_LONG.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
            <button
              className="btn small"
              disabled={busy || !dayName.trim()}
              onClick={() =>
                act(async () => {
                  await workoutApi.addPlanDay(plan.id, {
                    name: dayName.trim(),
                    dayOfWeek: dayDow === "" ? null : Number(dayDow),
                  });
                  setDayName("");
                  setDayDow("");
                })
              }
            >
              Add day
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DayView(props: {
  day: PlanDayFull;
  exercises: Exercise[];
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { day, exercises, busy, act } = props;
  const [exId, setExId] = useState("");
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("8-12");
  const [target, setTarget] = useState("");
  const [rest, setRest] = useState("");

  function move(index: number, dir: -1 | 1) {
    const ids = day.exercises.map((e) => e.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    act(() => workoutApi.updatePlanDay(day.id, { exerciseOrder: ids }));
  }

  return (
    <div
      style={{
        border: "1px solid var(--grid)",
        borderRadius: 8,
        padding: "8px 10px",
        background: "color-mix(in srgb, var(--ink) 2%, transparent)",
      }}
    >
      <div className="row between wrap">
        <strong style={{ fontSize: 13 }}>{day.name}</strong>
        <div className="row" style={{ gap: 6 }}>
          <select
            className="input"
            style={{ width: 130, padding: "3px 8px", fontSize: 12 }}
            value={day.dayOfWeek ?? ""}
            onChange={(e) =>
              act(() =>
                workoutApi.updatePlanDay(day.id, {
                  dayOfWeek: e.target.value === "" ? null : Number(e.target.value),
                }),
              )
            }
          >
            <option value="">Unscheduled</option>
            {DOW_LONG.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <button
            className="btn small danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete day "${day.name}"?`)) {
                act(() => workoutApi.deletePlanDay(day.id));
              }
            }}
          >
            ×
          </button>
        </div>
      </div>

      {day.exercises.length > 0 && (
        <table className="data" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Exercise</th>
              <th>Sets × reps</th>
              <th>Target</th>
              <th>Rest</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {day.exercises.map((pe, i) => (
              <tr key={pe.id}>
                <td>{i + 1}</td>
                <td title={pe.notes}>{pe.exerciseName}</td>
                <td>
                  {pe.sets}×{pe.reps}
                </td>
                <td>{pe.targetWeight ?? "—"}</td>
                <td>{pe.restSeconds != null ? `${pe.restSeconds}s` : "—"}</td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn small" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button
                      className="btn small"
                      disabled={busy || i === day.exercises.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove "${pe.exerciseName}" from this day?`)) {
                          act(() => workoutApi.deletePlanDayExercise(pe.id));
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row wrap" style={{ marginTop: 8 }}>
        <select
          className="input"
          style={{ flex: 2, minWidth: 130, padding: "3px 8px", fontSize: 12 }}
          value={exId}
          onChange={(e) => setExId(e.target.value)}
        >
          <option value="">Add exercise…</option>
          {exercises.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 58 }} type="number" title="Sets" value={sets} onChange={(e) => setSets(e.target.value)} />
        <input className="input" style={{ width: 66 }} title="Reps (e.g. 8-12)" value={reps} onChange={(e) => setReps(e.target.value)} />
        <input className="input" style={{ width: 70 }} type="number" placeholder="wt" title="Target weight" value={target} onChange={(e) => setTarget(e.target.value)} />
        <input className="input" style={{ width: 70 }} type="number" placeholder="rest s" title="Rest seconds" value={rest} onChange={(e) => setRest(e.target.value)} />
        <button
          className="btn small"
          disabled={busy || !exId}
          onClick={() =>
            act(async () => {
              await workoutApi.addPlanDayExercise(day.id, {
                exerciseId: Number(exId),
                sets: Number(sets) || 3,
                reps: reps || "8-12",
                targetWeight: target === "" ? null : Number(target),
                restSeconds: rest === "" ? null : Number(rest),
              });
              setExId("");
            })
          }
        >
          Add
        </button>
      </div>
    </div>
  );
}
