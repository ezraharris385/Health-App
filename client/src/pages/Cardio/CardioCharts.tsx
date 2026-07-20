import { useMemo } from "react";
import type { CardioSession } from "@shared/types";
import { ChartCard, HistoryBars, Legend, SERIES, TrendLine } from "../../viz/ChartKit";
import { miFromKm } from "../../units";

/**
 * 30-day cardio history: distance line + stacked run/walk step bars.
 * Manual step overrides are split proportionally to the run/walk estimates so
 * the stacked bars always sum to the effective step count.
 */
export function CardioCharts(props: { cardio: CardioSession[] }) {
  const data = useMemo(() => {
    const byDate = new Map<string, { km: number; runSteps: number; walkSteps: number }>();
    for (const c of props.cardio) {
      const entry = byDate.get(c.date) ?? { km: 0, runSteps: 0, walkSteps: 0 };
      entry.km += c.distanceKm;
      const estRun = c.estimatedStepsRun ?? 0;
      const estWalk = c.estimatedStepsWalked ?? 0;
      if (c.steps !== null) {
        const estTotal = estRun + estWalk;
        if (estTotal > 0) {
          entry.runSteps += Math.round((c.steps * estRun) / estTotal);
          entry.walkSteps += Math.round((c.steps * estWalk) / estTotal);
        } else {
          entry.walkSteps += c.steps;
        }
      } else {
        entry.runSteps += estRun;
        entry.walkSteps += estWalk;
      }
      byDate.set(c.date, entry);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-30)
      .map(([date, v]) => ({
        date: date.slice(5),
        // Accumulated canonical km -> shown in miles.
        mi: Math.round(miFromKm(v.km) * 100) / 100,
        runSteps: v.runSteps,
        walkSteps: v.walkSteps,
      }));
  }, [props.cardio]);

  return (
    <ChartCard title="Cardio history" sub="Distance and steps per training day (last 30 days with activity)">
      {data.length === 0 ? (
        <p className="empty">No cardio history yet — charts appear after your first logged session.</p>
      ) : (
        <>
          <TrendLine
            data={data}
            x="date"
            height={160}
            unit="mi"
            series={[{ key: "mi", name: "Distance", color: SERIES[0] }]}
          />
          <HistoryBars
            data={data}
            x="date"
            height={160}
            stacked
            unit="steps"
            bars={[
              { key: "runSteps", name: "Run steps", color: SERIES[5] },
              { key: "walkSteps", name: "Walked steps", color: SERIES[4] },
            ]}
          />
          <Legend
            items={[
              { name: "Distance (mi)", color: SERIES[0] },
              { name: "Run steps", color: SERIES[5] },
              { name: "Walked steps", color: SERIES[4] },
            ]}
          />
        </>
      )}
    </ChartCard>
  );
}
