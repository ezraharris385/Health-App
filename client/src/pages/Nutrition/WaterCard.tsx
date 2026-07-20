/**
 * Water tracking for the active day: quick-add buttons (+8 / +16 fl oz / custom
 * fl oz), total vs goal meter, and the day's per-entry list with delete. The DB
 * stores ml; the UI is imperial (fl oz) — conversion happens via ../../units.
 */
import { useState } from "react";
import { nutritionApi, type WaterSummary } from "../../api/nutrition";
import { FLOZ, flozFromMl, mlFromFloz } from "../../units";
import { Meter } from "../../viz/ChartKit";

// Rounded ml for the imperial quick-add sizes (8 fl oz ≈ 237 ml, 16 fl oz ≈ 473 ml).
const CUP_ML = 237;
const PINT_ML = 473;

export function WaterCard(props: {
  water: WaterSummary | null;
  date: string;
  onChange: () => void;
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const w = props.water;
  const totalMl = Math.round(w?.totalMl ?? 0);
  const goalMl = w?.goalMl ?? 0;
  const totalFloz = Math.round(flozFromMl(totalMl));
  const goalFloz = Math.round(flozFromMl(goalMl));

  async function addMl(amountMl: number) {
    if (!Number.isFinite(amountMl) || amountMl <= 0) {
      setError("Enter a positive amount in fl oz");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await nutritionApi.addWater({ date: props.date, amountMl });
      setCustom("");
      props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log water");
    } finally {
      setBusy(false);
    }
  }

  function addCustomFloz() {
    const floz = Number(custom);
    if (!Number.isFinite(floz) || floz <= 0) {
      setError("Enter a positive amount in fl oz");
      return;
    }
    addMl(Math.round(mlFromFloz(floz)));
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
        percent={goalMl > 0 ? (totalMl / goalMl) * 100 : 0}
        detail={`${totalFloz} / ${goalFloz} ${FLOZ}`}
        color="var(--series-5)"
      />
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => addMl(CUP_ML)} disabled={busy}>
          +8 {FLOZ}
        </button>
        <button className="btn" onClick={() => addMl(PINT_ML)} disabled={busy}>
          +16 {FLOZ}
        </button>
        <input
          className="input"
          style={{ width: 96 }}
          type="number"
          min={1}
          placeholder={FLOZ}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustomFloz();
          }}
        />
        <button className="btn primary" onClick={addCustomFloz} disabled={busy}>
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
                <td>
                  {flozFromMl(e.amountMl).toFixed(1)} {FLOZ}
                </td>
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
        <p className="empty">No water logged for this day yet — tap +8 fl oz after a glass.</p>
      )}
    </div>
  );
}
