/**
 * Shared chart components. All segments use these so every chart in the app
 * reads the same way: hairline grid, thin marks, rounded data ends, muted
 * axes, themed tooltip, light/dark aware (colors come from CSS variables).
 *
 * Series slots follow the validated palette order:
 *   1 blue, 2 green, 3 magenta, 4 yellow, 5 aqua, 6 orange, 7 violet, 8 red
 */
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

const axisTick = { fill: "var(--muted)", fontSize: 11 } as const;

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
} as const;

export function ChartCard(props: { title: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card">
      <div className="row between">
        <h3>{props.title}</h3>
        {props.actions}
      </div>
      {props.sub && <div className="card-sub">{props.sub}</div>}
      {props.children}
    </div>
  );
}

export function StatTile(props: {
  label: string;
  value: string | number;
  delta?: string;
  deltaDirection?: "up" | "down" | "flat";
}) {
  return (
    <div className="card stat-tile">
      <span className="label">{props.label}</span>
      <span className="value">{props.value}</span>
      {props.delta && (
        <span className={`delta ${props.deltaDirection ?? ""}`}>{props.delta}</span>
      )}
    </div>
  );
}

export interface SeriesSpec {
  key: string;
  name: string;
  /** CSS color; defaults to palette order */
  color?: string;
}

export function TrendLine(props: {
  data: Record<string, unknown>[];
  x: string;
  series: SeriesSpec[];
  height?: number;
  unit?: string;
  yDomain?: [number | "auto", number | "auto"];
  referenceY?: { value: number; label?: string };
}) {
  const h = props.height ?? 220;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={props.data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={props.x} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} minTickGap={24} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={props.yDomain ?? ["auto", "auto"]} width={54} />
        <Tooltip contentStyle={tooltipStyle} formatter={fmtWithUnit(props.unit)} />
        {props.referenceY && (
          <ReferenceLine
            y={props.referenceY.value}
            stroke="var(--baseline)"
            strokeDasharray="4 3"
            label={{ value: props.referenceY.label, fill: "var(--muted)", fontSize: 11, position: "insideTopRight" }}
          />
        )}
        {props.series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? SERIES[i % SERIES.length]}
            strokeWidth={2}
            dot={props.data.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: s.color ?? SERIES[i % SERIES.length] } : false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HistoryBars(props: {
  data: Record<string, unknown>[];
  x: string;
  bars: SeriesSpec[];
  stacked?: boolean;
  height?: number;
  unit?: string;
  referenceY?: { value: number; label?: string };
}) {
  const h = props.height ?? 220;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={props.data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={props.x} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} minTickGap={24} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={54} />
        <Tooltip contentStyle={tooltipStyle} formatter={fmtWithUnit(props.unit)} cursor={{ fill: "color-mix(in srgb, var(--ink) 4%, transparent)" }} />
        {props.referenceY && (
          <ReferenceLine
            y={props.referenceY.value}
            stroke="var(--baseline)"
            strokeDasharray="4 3"
            label={{ value: props.referenceY.label, fill: "var(--muted)", fontSize: 11, position: "insideTopRight" }}
          />
        )}
        {props.bars.map((b, i) => {
          const isTop = !props.stacked || i === props.bars.length - 1;
          return (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.name}
              stackId={props.stacked ? "stack" : undefined}
              fill={b.color ?? SERIES[i % SERIES.length]}
              radius={isTop ? [3, 3, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={26}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 0-100 coverage meter (nutrients, goals). */
export function Meter(props: {
  label: string;
  percent: number; // 0-100
  detail?: string;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(100, props.percent));
  const color =
    props.color ?? (pct >= 100 ? "var(--status-good)" : pct >= 50 ? "var(--series-1)" : "var(--series-4)");
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="name">{props.label}</span>
        <span className="val">{props.detail ?? `${Math.round(pct)}%`}</span>
      </div>
      <div className="track" style={{ background: "color-mix(in srgb, var(--ink) 8%, transparent)" }}>
        <div className="fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Simple legend row (use when a chart has ≥2 series). */
export function Legend(props: { items: { name: string; color: string }[] }) {
  return (
    <div className="row wrap" style={{ marginTop: 8, gap: 14 }}>
      {props.items.map((it) => (
        <span key={it.name} className="row" style={{ gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: it.color, display: "inline-block" }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

function fmtWithUnit(unit?: string) {
  return (value: unknown) => {
    const n = typeof value === "number" ? Math.round(value * 10) / 10 : value;
    return unit ? `${n} ${unit}` : `${n}`;
  };
}
