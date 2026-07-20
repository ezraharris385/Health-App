/**
 * Caloric-balance card: intake vs total burn (baseline TDEE + logged exercise)
 * and the resulting net for the day. Without a body profile (age, height, and a
 * known weight) there is no baseline, so we show intake + exercise burn only and
 * point the user to Settings. Data comes from GET /api/dashboard/energy.
 */
import { Link } from "react-router-dom";
import type { EnergyBalance } from "@shared/types";
import { LB } from "../../units";
import { Meter, StatTile } from "../../viz/ChartKit";

const STATUS_WORD = {
  deficit: "deficit",
  surplus: "surplus",
  even: "maintaining",
} as const;

/**
 * Goal-agnostic tone shared with the Dashboard energy tile: a deficit and a
 * surplus both read as "off maintenance" in one neutral brand accent (never
 * green-good vs red-bad, which would assume a cut/bulk goal); on-balance is
 * neutral. Keeping both energy surfaces on this mapping stops them signalling
 * the same day oppositely.
 */
function energyStatusColor(status: EnergyBalance["status"]): string {
  return status === "surplus" || status === "deficit" ? "var(--accent)" : "var(--ink-2)";
}

export function EnergyCard(props: { energy: EnergyBalance | null; date: string }) {
  const e = props.energy;

  return (
    <div className="card">
      <div className="row between">
        <h3>Energy balance — {props.date}</h3>
        {e?.status && (
          <span className="delta" style={{ color: energyStatusColor(e.status) }}>
            {STATUS_WORD[e.status]}
          </span>
        )}
      </div>

      {!e ? (
        <p className="empty">Loading…</p>
      ) : e.hasProfile ? (
        <>
          <div className="grid cols-3">
            <StatTile label="Intake (kcal)" value={Math.round(e.intakeCalories)} />
            <StatTile label="Total burn (kcal)" value={Math.round(e.totalBurn)} />
            <StatTile
              label="Net (kcal)"
              value={`${e.net != null && e.net > 0 ? "+" : ""}${Math.round(e.net ?? 0)}`}
              delta={e.status ? STATUS_WORD[e.status] : undefined}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Meter
              label="Intake vs burn"
              percent={e.totalBurn > 0 ? (e.intakeCalories / e.totalBurn) * 100 : 0}
              detail={`${Math.round(e.intakeCalories)} / ${Math.round(e.totalBurn)} kcal`}
            />
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
            Baseline (TDEE) {Math.round(e.baselineBurn ?? 0)} kcal · Exercise burn{" "}
            {Math.round(e.exerciseBurn)} kcal
            {e.weightLb != null ? ` · ${Math.round(e.weightLb)} ${LB}` : ""}
          </p>
        </>
      ) : (
        <>
          <div className="grid cols-2">
            <StatTile label="Intake (kcal)" value={Math.round(e.intakeCalories)} />
            <StatTile label="Exercise burn (kcal)" value={Math.round(e.exerciseBurn)} />
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "12px 0 0" }}>
            Add your age, height, and a weight in <Link to="/settings">Settings</Link> to see your
            baseline burn and daily net balance.
          </p>
        </>
      )}
    </div>
  );
}
