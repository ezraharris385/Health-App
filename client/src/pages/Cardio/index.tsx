import { useCallback, useEffect, useMemo, useState } from "react";
import type { CardioSession } from "@shared/types";
import { AgentChat } from "../../components/AgentChat";
import { StatTile } from "../../viz/ChartKit";
import { cardioTotalSteps, workoutApi, type WeekSchedule } from "../../api/workout";
import { fmtMiles } from "../../units";
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
    if (!week) return { count: 0, distanceKm: 0, minutes: 0, steps: 0 };
    const all = week.days.flatMap((d) => d.cardio);
    return {
      count: all.length,
      distanceKm: all.reduce((a, c) => a + c.distanceKm, 0),
      minutes: all.reduce((a, c) => a + c.durationMinutes, 0),
      steps: all.reduce((a, c) => a + cardioTotalSteps(c), 0),
    };
  }, [week]);

  if (!loaded) return <p className="empty">Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Cardio</h1>
      <p className="page-sub">
        Runs, walks, intervals, HIIT, cycling and more — by distance, duration, or steps.
      </p>
      {error && <p className="error-text">{error}</p>}

      <div className="grid cols-4">
        <StatTile label="Sessions this week" value={weekStats.count} />
        <StatTile
          label="Distance this week"
          value={weekStats.distanceKm > 0 ? fmtMiles(weekStats.distanceKm, 1) : "—"}
        />
        <StatTile
          label="Active minutes"
          value={weekStats.minutes > 0 ? Math.round(weekStats.minutes).toLocaleString() : "—"}
        />
        <StatTile
          label="Steps this week"
          value={weekStats.steps > 0 ? weekStats.steps.toLocaleString() : "—"}
          delta="entered + estimated"
        />
      </div>

      {/* minWidth: 0 lets each card shrink below its content's min width on
          phones (the nowrap history table otherwise forces the page past 390px
          — the table scrolls inside its card instead). */}
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <CardioCard cardio={cardio} onChange={reload} />
        </div>
        <div style={{ minWidth: 0 }}>
          <CardioCharts cardio={cardio} />
        </div>
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
