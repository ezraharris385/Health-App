/**
 * Water tracking for the active day: quick-add buttons (+250/+500/custom ml),
 * total vs goal meter, and the day's per-entry list with delete.
 */
import { useState } from "react";
import { nutritionApi, type WaterSummary } from "../../api/nutrition";
import { Meter } from "../../viz/ChartKit";

export function WaterCard(props: {
  water: WaterSummary | null;
  date: string;
  onChange: () => void;
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const w = props.water;
  const total = Math.round(w?.totalMl ?? 0);
  const goal = w?.goalMl ?? 0;

  async function add(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive amount in ml");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await nutritionApi.addWater({ date: props.date, amountMl: amount });
      setCustom("");
      props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log water");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await nutritionApi.deleteWater(id);
    } finally {
      setBusy(false);
      props.onChange();
    }
  }

  return (
    <div className="card">
      <h3>Water — {props.date}</h3>
      <Meter
        label="Total"
        percent={goal > 0 ? (total / goal) * 100 : 0}
        detail={`${total} / ${goal} ml`}
        color="var(--series-5)"
      />
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => add(250)} disabled={busy}>
          +250 ml
        </button>
        <button className="btn" onClick={() => add(500)} disabled={busy}>
          +500 ml
        </button>
        <input
          className="input"
          style={{ width: 96 }}
          type="number"
          min={1}
          placeholder="ml"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add(Number(custom));
          }}
        />
        <button className="btn primary" onClick={() => add(Number(custom))} disabled={busy}>
          Add
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}

      {w && w.entries.length > 0 ? (
        <table className="data" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Logged</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {w.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.loggedAt.length >= 16 ? e.loggedAt.slice(11, 16) : e.loggedAt}</td>
                <td>{Math.round(e.amountMl)} ml</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn small danger" onClick={() => remove(e.id)} disabled={busy}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">No water logged for this day yet — tap +250 after a glass.</p>
      )}
    </div>
  );
}
