import { useEffect, useMemo, useState } from "react";
import type { Exercise } from "@shared/types";
import { ChartCard, HistoryBars, Legend, SERIES, TrendLine } from "../../viz/ChartKit";
import { workoutApi, type ExercisePerformance, type SessionFull } from "../../api/workout";

/** Per-exercise progress: volume bars + best-set weight / estimated 1RM lines. */
export function PerformanceCard(props: {
  exercises: Exercise[];
  sessions: SessionFull[];
  reloadKey: number;
}) {
  const { exercises, sessions, reloadKey } = props;
  const [selectedId, setSelectedId] = useState<string>("");
  const [perf, setPerf] = useState<ExercisePerformance | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the most recently trained exercise, falling back to the first in the library.
  useEffect(() => {
    if (selectedId) return;
    const lastTrained = sessions.find((s) => s.sets.length > 0)?.sets[0]?.exerciseId;
    const fallback = lastTrained ?? exercises[0]?.id;
    if (fallback) setSelectedId(String(fallback));
  }, [sessions, exercises, selectedId]);

  useEffect(() => {
    const id = Number(selectedId);
    if (!id) {
      setPerf(null);
      return;
    }
    workoutApi
      .performance(id, 180)
      .then((p) => {
        setPerf(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load performance"));
  }, [selectedId, reloadKey]);

  const chartData = useMemo(
    () =>
      (perf?.points ?? []).map((p) => ({
        date: p.date.slice(5),
        volume: p.volume,
        best: p.bestWeight,
        est1RM: p.est1RM,
        hold: p.bestDurationSeconds,
      })),
    [perf],
  );

  const latest = perf?.points[perf.points.length - 1];
  // Timed work (planks etc.) charts as best hold seconds — only when present.
  const hasTimed = (perf?.points ?? []).some((p) => p.bestDurationSeconds !== null);

  return (
    <ChartCard
      title="Exercise progress"
      sub="Training volume and best set over the last 180 days"
      actions={
        <select
          className="input"
          style={{ width: 190, padding: "3px 8px", fontSize: 12 }}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">Pick an exercise…</option>
          {exercises.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
      }
    >
      {error && <p className="error-text">{error}</p>}
      {exercises.length === 0 ? (
        <p className="empty">No exercises yet — add some in the library or ask the coach for a plan.</p>
      ) : !perf || perf.points.length === 0 ? (
        <p className="empty">
          No logged sets for this exercise yet — history shows up once you log sessions.
        </p>
      ) : (
        <>
          {latest && (
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <span className="chip">
                Last:{" "}
                {latest.bestWeight !== null
                  ? `${latest.bestWeight} lb × ${latest.bestReps}`
                  : latest.bestSet}
              </span>
              {latest.est1RM !== null && (
                <span className="chip">Est. max single: {Math.round(latest.est1RM)} lb</span>
              )}
              <span className="chip">{latest.sets} sets / {latest.volume.toLocaleString()} volume</span>
            </div>
          )}
          <HistoryBars
            data={chartData}
            x="date"
            height={150}
            bars={[{ key: "volume", name: "Volume", color: SERIES[0] }]}
          />
          <TrendLine
            data={chartData}
            x="date"
            height={150}
            series={[
              { key: "best", name: "Best set weight (lb)", color: SERIES[1] },
              { key: "est1RM", name: "Estimated 1-rep max (lb)", color: SERIES[6] },
              ...(hasTimed ? [{ key: "hold", name: "Best hold (s)", color: SERIES[3] }] : []),
            ]}
          />
          <Legend
            items={[
              { name: "Volume (reps × weight)", color: SERIES[0] },
              { name: "Best set weight (lb)", color: SERIES[1] },
              { name: "Estimated 1-rep max (lb)", color: SERIES[6] },
              ...(hasTimed ? [{ name: "Best hold (s)", color: SERIES[3] }] : []),
            ]}
          />
        </>
      )}
    </ChartCard>
  );
}
