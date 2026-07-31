/**
 * Weight log: one entry per day (upsert), 90-day trend line with an optional
 * goal reference line, plus the most recent entries with delete.
 */
import { useState } from "react";
import { nutritionApi, type WeightHistoryResponse } from "../../api/nutrition";
import { LB } from "../../units";
import { TrendLine } from "../../viz/ChartKit";
import { fmtDateShort, fmtDay } from "./util";

export function WeightCard(props: {
  weight: WeightHistoryResponse | null;
  date: string;
  onChange: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wh = props.weight;
  const unit = LB; // imperial only — body weight is canonical lb, shown as lb
  const entries = wh?.entries ?? [];
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  const data = entries.map((e) => ({ day: fmtDay(e.date), weight: e.weight }));

  async function log() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError(`Enter a weight in ${unit}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await nutritionApi.logWeight({ date: props.date, weight: n });
      setValue("");
      props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log weight");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await nutritionApi.deleteWeight(id);
    } finally {
      setBusy(false);
      props.onChange();
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Weight — last 90 days</h3>
        {latest && (
          <span className="chip">
            latest: {latest.weight} {unit} ({fmtDateShort(latest.date)})
          </span>
        )}
      </div>
      {/* Quick entry stays ABOVE the chart/history — log first, browse second. */}
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input
          className="input"
          style={{ width: 110 }}
          type="number"
          step={0.1}
          min={1}
          placeholder={unit}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") log();
          }}
        />
        <button className="btn primary" onClick={log} disabled={busy}>
          Log for {fmtDateShort(props.date)}
        </button>
        {wh?.weightGoal != null && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            goal {wh.weightGoal} {unit}
          </span>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}

      {entries.length > 0 ? (
        <>
          <TrendLine
            data={data}
            x="day"
            series={[{ key: "weight", name: `Weight (${unit})` }]}
            unit={unit}
            referenceY={
              wh?.weightGoal != null ? { value: wh.weightGoal, label: "goal" } : undefined
            }
          />
          <table className="data" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Weight</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries
                .slice(-5)
                .reverse()
                .map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDateShort(e.date)}</td>
                    <td>
                      {e.weight} {unit}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn small danger"
                        onClick={() => remove(e.id)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="empty">
          No weight entries yet — one entry per day builds the trend. Log today's weight above.
        </p>
      )}
    </div>
  );
}
