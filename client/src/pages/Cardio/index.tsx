import { useCallback, useEffect, useMemo, useState } from "react";
import type { CardioSession } from "@shared/types";
import { AgentChat } from "../../components/AgentChat";
import { StatTile } from "../../viz/ChartKit";
import { cardioTotalSteps, workoutApi, type WeekSchedule } from "../../api/workout";
import { CardioCard } from "./CardioCard";
import { CardioCharts } from "./CardioCharts";

export default function CardioPage() {
  const [cardio, setCardio] = useState<CardioSession[]>([]);
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [ca, wk] = await Promise.all([workoutApi.cardio(90), workoutApi.week()]);
      setCardio(ca);
      setWeek(wk);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cardio data");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const weekStats = useMemo(() => {
    if (!week) return { count: 0, distanceKm: 0, steps: 0 };
    const all = week.days.flatMap((d) => d.cardio);
    return {
      count: all.length,
      distanceKm: all.reduce((a, c) => a + c.distanceKm, 0),
      steps: all.reduce((a, c) => a + cardioTotalSteps(c), 0),
    };
  }, [week]);

  if (!loaded) return <p className="empty">Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Cardio</h1>
      <p className="page-sub">
        Runs, jogs, walks, and intervals — distance, steps, and how they felt.
      </p>
      {error && <p className="error-text">{error}</p>}

      <div className="grid cols-3">
        <StatTile label="Cardio sessions this week" value={weekStats.count} />
        <StatTile
          label="Distance this week"
          value={`${Math.round(weekStats.distanceKm * 10) / 10} km`}
        />
        <StatTile
          label="Steps this week"
          value={weekStats.steps.toLocaleString()}
          delta="manual + estimated"
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <CardioCard cardio={cardio} onChange={reload} />
        <CardioCharts cardio={cardio} />
      </div>

      <div style={{ marginTop: 14 }}>
        <AgentChat
          agent="workout"
          title="Cardio Coach"
          placeholder="Log a run ('5k in 28 min, felt strong') or ask how your week looks."
          onReply={reload}
        />
      </div>
    </div>
  );
}
