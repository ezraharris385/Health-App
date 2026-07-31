/**
 * Caloric-balance strip: one compact "In X · Out ~Y kcal" line plus a single
 * framing sentence, expandable to the full tile breakdown (intake / total burn /
 * net, meter, baseline detail). For TODAY the framing follows the mid-day
 * contract — "Room left today: X kcal" in neutral ink (a half-finished day is
 * not a deficit); past dates keep the net/deficit/surplus framing. Without a
 * body profile (age, height, and a known weight) there is no baseline, so we
 * show intake + exercise burn only and point the user to Settings. Data comes
 * from GET /api/dashboard/energy.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { EnergyBalance } from "@shared/types";
import { todayStr } from "../../api/http";
import { LB } from "../../units";
import { Meter, StatTile } from "../../viz/ChartKit";
import { fmtDateShort } from "./util";

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

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const NET_EXPLAINER = "Net = eaten − burned (baseline + exercise)";

export function EnergyCard(props: { energy: EnergyBalance | null; date: string }) {
  const [open, setOpen] = useState(false);
  const e = props.energy;
  const isToday = props.date === todayStr();

  return (
    <div className="card">
      <div className="row between">
        <h3>Energy balance — {fmtDateShort(props.date)}</h3>
        {e?.status && !isToday && (
          <span className="delta" style={{ color: energyStatusColor(e.status) }}>
            {STATUS_WORD[e.status]}
          </span>
        )}
      </div>

      {!e ? (
        <p className="empty">Loading…</p>
      ) : e.hasProfile ? (
        <>
          <div className="row between wrap" style={{ gap: 8 }}>
            <span
              style={{
                fontSize: 17,
                fontWeight: 750,
                letterSpacing: "-0.01em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              In {fmt(e.intakeCalories)} · Out ~{fmt(e.totalBurn)} kcal
            </span>
            <button className="btn small" onClick={() => setOpen((s) => !s)}>
              {open ? "Hide details" : "Details"}
            </button>
          </div>

          {isToday ? (
            // Mid-day framing: today isn't finished, so no deficit/surplus verdict —
            // neutral ink, room left vs the estimated full-day burn.
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              <span style={{ fontWeight: 650, color: "var(--ink)" }}>
                {e.totalBurn - e.intakeCalories >= 0
                  ? `Room left today: ${fmt(e.totalBurn - e.intakeCalories)} kcal`
                  : `Over your full-day burn by ${fmt(e.intakeCalories - e.totalBurn)} kcal`}
              </span>
              <span style={{ color: "var(--muted)" }}> · food so far vs full-day burn (est.)</span>
            </p>
          ) : (
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              <span style={{ fontWeight: 650, color: energyStatusColor(e.status) }}>
                Net {e.net != null && e.net > 0 ? "+" : ""}
                {fmt(e.net ?? 0)} kcal
                {e.status ? ` · ${STATUS_WORD[e.status]}` : ""}
              </span>
              <span style={{ color: "var(--muted)" }}> · {NET_EXPLAINER}</span>
            </p>
          )}

          {open && (
            <>
              <div className="grid cols-3" style={{ marginTop: 12 }}>
                <StatTile label="Intake (kcal)" value={Math.round(e.intakeCalories)} />
                <StatTile label="Total burn (kcal)" value={Math.round(e.totalBurn)} />
                <StatTile
                  label="Net (kcal)"
                  value={`${e.net != null && e.net > 0 ? "+" : ""}${Math.round(e.net ?? 0)}`}
                  delta={isToday ? "so far today" : e.status ? STATUS_WORD[e.status] : undefined}
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
                {NET_EXPLAINER} · Baseline (TDEE) {Math.round(e.baselineBurn ?? 0)} kcal · Exercise
                burn {Math.round(e.exerciseBurn)} kcal
                {e.weightLb != null ? ` · ${Math.round(e.weightLb)} ${LB}` : ""}
              </p>
            </>
          )}
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
