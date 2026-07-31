import { useMemo } from "react";
import type { CardioSession } from "@shared/types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, HistoryBars, Legend, SERIES } from "../../viz/ChartKit";
import { miFromKm } from "../../units";

// Match ChartKit's shared axis/tooltip styling so this chart reads like the
// rest of the app (we can't use ChartKit's TrendLine here — it hard-wires
// connectNulls, and this chart must BREAK the line on no-distance days).
const axisTick = { fill: "var(--muted)", fontSize: 11 } as const;
const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
} as const;

/**
 * Distance line with real gaps: days whose sessions carried no distance
 * (e.g. a HIIT day) are null, and connectNulls stays off so the line breaks
 * instead of plunging to a fake 0 mi.
 */
function DistanceLine(props: { data: { date: string; mi: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={props.data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "var(--baseline)" }}
          minTickGap={24}
        />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={54} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: unknown) =>
            typeof value === "number" ? `${Math.round(value * 10) / 10} mi` : "no distance"
          }
        />
        <Line
          type="monotone"
          dataKey="mi"
          name="Distance"
          stroke={SERIES[0]}
          strokeWidth={2}
          dot={props.data.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: SERIES[0] } : false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

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
        // Accumulated canonical km -> shown in miles. Days with no distance
        // are null (a gap in the line), never a fake 0.
        mi: v.km > 0 ? Math.round(miFromKm(v.km) * 100) / 100 : null,
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
          <DistanceLine data={data} />
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
