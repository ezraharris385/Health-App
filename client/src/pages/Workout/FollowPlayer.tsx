import { useMemo, useState } from "react";
import type { Exercise, ExerciseTrackingType } from "@shared/types";
import { workoutApi, type FullSessionEntryInput, type PlanDayFull } from "../../api/workout";
import {
  buildMeasure,
  describeMeasure,
  describeTarget,
  emptyDraft,
  trackingLabel,
  TrackingInputs,
  type Measure,
  type TrackDraft,
} from "./tracking";

/**
 * Follow mode: a phone-first guided player that steps through one plan day's
 * exercises one at a time. Each step shows the target (per its tracking type)
 * plus intensity & goal recommendations, with big inputs to log the actual
 * set(s) as you go. Finish saves the whole thing as one completed session
 * linked to the plan day (via logFullSession).
 */
export function FollowPlayer(props: {
  planName: string;
  day: PlanDayFull;
  exercises: Exercise[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { planName, day, exercises, onClose, onSaved } = props;
  const items = day.exercises;

  const exById = useMemo(() => {
    const m = new Map<number, Exercise>();
    for (const e of exercises) m.set(e.id, e);
    return m;
  }, [exercises]);

  const [idx, setIdx] = useState(0);
  // logged sets keyed by plan-day-exercise id
  const [logged, setLogged] = useState<Record<number, Measure[]>>({});
  const [draft, setDraft] = useState<TrackDraft>(() => emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalLogged = useMemo(
    () => Object.values(logged).reduce((a, arr) => a + arr.length, 0),
    [logged],
  );

  const cur = items[idx];
  const ex = cur ? exById.get(cur.exerciseId) : undefined;
  const type: ExerciseTrackingType = ex?.trackingType ?? "weight_reps";
  const curLog = cur ? (logged[cur.id] ?? []) : [];

  function go(next: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    setIdx(clamped);
    setDraft(emptyDraft());
    setError(null);
  }

  function logSet() {
    if (!cur) return;
    const res = buildMeasure(type, draft, ex?.name ?? "Exercise");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLogged((prev) => ({ ...prev, [cur.id]: [...(prev[cur.id] ?? []), res.measure] }));
    setDraft(emptyDraft());
    setError(null);
  }

  function removeSet(peId: number, i: number) {
    setLogged((prev) => ({ ...prev, [peId]: (prev[peId] ?? []).filter((_, j) => j !== i) }));
  }

  async function finish() {
    const entries: FullSessionEntryInput[] = [];
    for (const pe of items) {
      for (const m of logged[pe.id] ?? []) {
        entries.push({ exerciseId: pe.exerciseId, sets: 1, ...m });
      }
    }
    if (entries.length === 0) {
      setError("Log at least one set before finishing, or close without saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await workoutApi.sessionFull({ planDayId: day.id, entries });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  }

  function requestClose() {
    if (totalLogged > 0 && !window.confirm("Discard this workout? Logged sets won't be saved.")) {
      return;
    }
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "var(--page)",
        overflowY: "auto",
        padding: "16px 14px calc(24px + env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }} className="stack">
        <div className="row between wrap">
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Follow: {day.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{planName}</div>
          </div>
          <button className="btn" disabled={busy} onClick={requestClose} title="Close">
            Close ✕
          </button>
        </div>

        {items.length === 0 ? (
          <div className="card">
            <p className="empty" style={{ padding: 0 }}>
              This day has no exercises yet — add some to the plan day first.
            </p>
          </div>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
              <span className="chip">
                Exercise {idx + 1} of {items.length}
              </span>
              <div className="row" style={{ gap: 4 }}>
                {items.map((pe, i) => (
                  <span
                    key={pe.id}
                    title={pe.exerciseName}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background:
                        i === idx
                          ? "var(--accent)"
                          : (logged[pe.id]?.length ?? 0) > 0
                            ? "var(--good-text)"
                            : "var(--grid)",
                    }}
                  />
                ))}
              </div>
            </div>

            {cur && (
              <div className="card stack" style={{ gap: 12 }}>
                <div className="row between wrap">
                  <h3 style={{ margin: 0 }}>{cur.exerciseName}</h3>
                  <span className="chip">{trackingLabel(type)}</span>
                </div>

                <div className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>Target</span>
                    <strong style={{ fontSize: 15 }}>{describeTarget(cur, type)}</strong>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <strong>Intensity:</strong>{" "}
                    {ex?.intensityRec ? (
                      ex.intensityRec
                    ) : (
                      <span style={{ color: "var(--muted)" }}>no recommendation</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <strong>Goal:</strong>{" "}
                    {ex?.goalRec ? (
                      ex.goalRec
                    ) : (
                      <span style={{ color: "var(--muted)" }}>no recommendation</span>
                    )}
                  </div>
                  {ex?.instructions && (
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
                      <strong>Form:</strong> {ex.instructions}
                    </div>
                  )}
                  {cur.notes && (
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
                      <strong>Note:</strong> {cur.notes}
                    </div>
                  )}
                </div>

                {curLog.length > 0 && (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {curLog.map((m, i) => (
                      <span
                        key={i}
                        className="chip"
                        style={{ color: "var(--good-text)", cursor: "pointer" }}
                        title="Tap to remove"
                        onClick={() => removeSet(cur.id, i)}
                      >
                        {describeMeasure(type, m)} ✕
                      </span>
                    ))}
                  </div>
                )}

                <div className="stack" style={{ gap: 10 }}>
                  <TrackingInputs
                    type={type}
                    draft={draft}
                    onChange={(patch) => setDraft({ ...draft, ...patch })}
                    placeholders={undefined}
                    showRpe
                    stacked
                    disabled={busy}
                  />
                  <button
                    className="btn primary"
                    disabled={busy}
                    style={{ padding: "12px 16px", fontSize: 15 }}
                    onClick={logSet}
                  >
                    Log set{curLog.length > 0 ? ` (${curLog.length} logged)` : ""}
                  </button>
                </div>

                {error && <p className="error-text">{error}</p>}
              </div>
            )}

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                disabled={busy || idx === 0}
                onClick={() => go(idx - 1)}
              >
                ← Prev
              </button>
              <button
                className="btn"
                style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                disabled={busy || idx === items.length - 1}
                onClick={() => go(idx + 1)}
              >
                Next →
              </button>
            </div>

            <button
              className="btn primary"
              style={{ padding: "14px 16px", fontSize: 16, width: "100%" }}
              disabled={busy || totalLogged === 0}
              onClick={finish}
            >
              Finish &amp; save{totalLogged > 0 ? ` (${totalLogged} set${totalLogged === 1 ? "" : "s"})` : ""}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
