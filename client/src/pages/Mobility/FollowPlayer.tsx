/**
 * Follow mode: a phone-first guided player that steps through one routine's
 * stretches one at a time. Each step shows a big PoseAnimation, the pose's
 * goal / focus / where-you-feel-it text and form cues, and a hold-seconds
 * countdown timer driven by the routine item (holdSeconds / reps / perSide,
 * falling back to the stretch's default hold). Prev/Next move between poses;
 * Finish offers to log the whole thing as one mobility session.
 */
import { useEffect, useMemo, useState } from "react";
import type { MobilityKind, Stretch, StretchCategory } from "@shared/types";
import { mobilityApi, type RoutineWithItems } from "../../api/mobility";
import { PoseAnimation } from "./PoseAnimation";

const FALLBACK_HOLD = 30;
const FEEL_LABELS = ["1 — rough", "2 — stiff", "3 — okay", "4 — good", "5 — great"];
const KINDS: MobilityKind[] = ["stretch", "yoga", "posture", "mixed"];

function fmt(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Derive a session kind from the poses used: their common category, else "mixed". */
function deriveKind(cats: StretchCategory[]): MobilityKind {
  if (cats.length === 0) return "stretch";
  const first = cats[0];
  return cats.every((c) => c === first) ? first : "mixed";
}

export function FollowPlayer(props: {
  routine: RoutineWithItems;
  stretches: Stretch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { routine, stretches, onClose, onSaved } = props;
  const items = routine.items;

  const stretchById = useMemo(() => {
    const m = new Map<number, Stretch>();
    for (const s of stretches) m.set(s.id, s);
    return m;
  }, [stretches]);

  const holdFor = useMemo(
    () => (i: number) => {
      const it = items[i];
      if (!it) return FALLBACK_HOLD;
      return it.holdSeconds ?? stretchById.get(it.stretchId)?.defaultHoldSeconds ?? FALLBACK_HOLD;
    },
    [items, stretchById],
  );

  const plannedMinutes = useMemo(() => {
    let sec = 0;
    items.forEach((it, i) => (sec += holdFor(i) * (it.perSide === 1 ? 2 : 1)));
    return Math.max(1, Math.round(sec / 60));
  }, [items, holdFor]);

  const defaultKind = useMemo(
    () =>
      deriveKind(
        items
          .map((it) => stretchById.get(it.stretchId)?.category)
          .filter((c): c is StretchCategory => Boolean(c)),
      ),
    [items, stretchById],
  );

  const [idx, setIdx] = useState(0);
  const [side, setSide] = useState<1 | 2>(1);
  const [remaining, setRemaining] = useState(() => holdFor(0));
  const [running, setRunning] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // finish-form state
  const [duration, setDuration] = useState(String(plannedMinutes));
  const [kind, setKind] = useState<MobilityKind>(defaultKind);
  const [feel, setFeel] = useState("");
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Countdown: one tick per second while running and time remains.
  useEffect(() => {
    if (!running || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [running, remaining]);

  const cur = items[idx];
  const stretch = cur ? stretchById.get(cur.stretchId) : undefined;
  const perSide = cur?.perSide === 1;
  const finished = remaining <= 0;

  function go(next: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    setIdx(clamped);
    setSide(1);
    setRemaining(holdFor(clamped));
    setRunning(false);
    setError(null);
  }

  function resetTimer() {
    setRemaining(holdFor(idx));
    setRunning(false);
  }

  function nextSide() {
    setSide(2);
    setRemaining(holdFor(idx));
    setRunning(true);
  }

  function requestClose() {
    if (!finishing && !window.confirm("Close the guided routine?")) return;
    onClose();
  }

  async function logSession() {
    const minutes = Number(duration);
    if (duration.trim() === "" || !Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter how many minutes it took");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mobilityApi.createSession({
        kind,
        routineId: routine.id,
        durationMinutes: minutes,
        feel: feel === "" ? null : Number(feel),
        report: report.trim(),
        notes: `Followed routine: ${routine.name}`,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log session");
      setBusy(false);
    }
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
            <div style={{ fontWeight: 800, fontSize: 18 }}>Follow: {routine.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {routine.focus || "Guided routine"}
            </div>
          </div>
          <button className="btn" disabled={busy} onClick={requestClose} title="Close">
            Close ✕
          </button>
        </div>

        {items.length === 0 ? (
          <div className="card">
            <p className="empty" style={{ padding: 0 }}>
              This routine has no stretches yet — add some, then follow it.
            </p>
          </div>
        ) : finishing ? (
          // ---------------------------------------------------------- finish
          <div className="card stack" style={{ gap: 12 }}>
            <h3 style={{ margin: 0 }}>Nice work — log this session?</h3>
            <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0 }}>
              You stepped through all {items.length} pose{items.length === 1 ? "" : "s"} of{" "}
              <strong>{routine.name}</strong>. Save it to your history, or skip.
            </p>
            <div className="row wrap">
              <label className="field" style={{ width: 120 }}>
                Minutes
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={600}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 110 }}>
                Kind
                <select
                  className="input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as MobilityKind)}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1, minWidth: 130 }}>
                Feel (optional)
                <select className="input" value={feel} onChange={(e) => setFeel(e.target.value)}>
                  <option value="">—</option>
                  {FEEL_LABELS.map((l, i) => (
                    <option key={l} value={i + 1}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              How did it go?
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. hips opened up nicely, right hamstring still tight — the coach reads this"
                value={report}
                onChange={(e) => setReport(e.target.value)}
              />
            </label>
            {error && <p className="error-text">{error}</p>}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn primary"
                style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                disabled={busy}
                onClick={logSession}
              >
                Log session
              </button>
              <button
                className="btn"
                style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                disabled={busy}
                onClick={onClose}
              >
                Skip &amp; close
              </button>
            </div>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => {
                setFinishing(false);
                setError(null);
              }}
            >
              ← Back to poses
            </button>
          </div>
        ) : (
          // ------------------------------------------------------------ player
          <>
            <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
              <span className="chip">
                Pose {idx + 1} of {items.length}
              </span>
              <div className="row" style={{ gap: 4 }}>
                {items.map((it, i) => (
                  <span
                    key={it.id}
                    title={it.stretchName}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: i === idx ? "var(--accent)" : i < idx ? "var(--good-text)" : "var(--grid)",
                    }}
                  />
                ))}
              </div>
            </div>

            {cur && (
              <div className="card stack" style={{ gap: 12, alignItems: "center" }}>
                <div className="row between wrap" style={{ width: "100%" }}>
                  <h3 style={{ margin: 0 }}>{stretch?.name ?? cur.stretchName ?? "Stretch"}</h3>
                  {stretch && <span className="chip">{stretch.category}</span>}
                </div>

                <div style={{ color: "var(--accent)" }}>
                  <PoseAnimation kind={stretch?.animKind ?? "none"} size={168} />
                </div>

                <div className="stack" style={{ gap: 6, width: "100%" }}>
                  {stretch?.goal && (
                    <div style={{ fontSize: 13 }}>
                      <strong>Goal:</strong> {stretch.goal}
                    </div>
                  )}
                  {stretch?.focus && (
                    <div style={{ fontSize: 13 }}>
                      <strong>Focus on:</strong> {stretch.focus}
                    </div>
                  )}
                  {stretch?.feelWhere && (
                    <div style={{ fontSize: 13 }}>
                      <strong>Where you feel it:</strong> {stretch.feelWhere}
                    </div>
                  )}
                  {stretch?.instructions && (
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
                      <strong>Form:</strong> {stretch.instructions}
                    </div>
                  )}
                  {stretch?.targetAreas && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      Targets: {stretch.targetAreas}
                    </div>
                  )}
                  {cur.notes && (
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
                      <strong>Note:</strong> {cur.notes}
                    </div>
                  )}
                </div>

                {/* dose + countdown */}
                <div className="row wrap" style={{ gap: 6, justifyContent: "center" }}>
                  {cur.reps != null && <span className="chip">×{cur.reps} reps</span>}
                  <span className="chip">{holdFor(idx)}s hold</span>
                  {perSide && (
                    <span className="chip" style={{ color: "var(--accent)" }}>
                      Side {side} of 2
                    </span>
                  )}
                </div>

                <div
                  style={{
                    fontSize: 46,
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.03em",
                    color: finished ? "var(--good-text)" : "var(--ink)",
                  }}
                  aria-live="polite"
                >
                  {fmt(remaining)}
                </div>

                <div className="row" style={{ gap: 8, justifyContent: "center", width: "100%" }}>
                  {perSide && finished && side === 1 ? (
                    <button
                      className="btn primary"
                      style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                      onClick={nextSide}
                    >
                      Next side →
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                      disabled={finished}
                      onClick={() => setRunning((r) => !r)}
                    >
                      {finished ? "Done" : running ? "Pause" : remaining === holdFor(idx) ? "Start" : "Resume"}
                    </button>
                  )}
                  <button
                    className="btn"
                    style={{ padding: "12px 14px", fontSize: 15 }}
                    onClick={resetTimer}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                disabled={idx === 0}
                onClick={() => go(idx - 1)}
              >
                ← Prev
              </button>
              {idx === items.length - 1 ? (
                <button
                  className="btn primary"
                  style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                  onClick={() => {
                    setDuration(String(plannedMinutes));
                    setKind(defaultKind);
                    setFinishing(true);
                  }}
                >
                  Finish →
                </button>
              ) : (
                <button
                  className="btn"
                  style={{ flex: 1, padding: "12px 8px", fontSize: 15 }}
                  onClick={() => go(idx + 1)}
                >
                  Next →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
