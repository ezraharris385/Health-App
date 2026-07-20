import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { EnergyBalance, ScoreHistory } from "@shared/types";
import { dashboardApi, type DashboardOverview } from "../../api/dashboard";
import { AgentChat } from "../../components/AgentChat";
import { ChartCard, Meter, StatTile, TrendLine } from "../../viz/ChartKit";
import { LB, fmtFloz, fmtMiles, flozFromMl } from "../../units";

function scoreColor(score: number): string {
  if (score >= 80) return "var(--status-good)";
  if (score >= 60) return "var(--status-warning)";
  if (score >= 40) return "var(--status-serious)";
  return "var(--status-critical)";
}

/** Signed "+120 kcal" / "−420 kcal" for the caloric-balance net. */
function fmtKcal(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} kcal`;
}

const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: "sedentary",
  light: "lightly active",
  moderate: "moderately active",
  active: "active",
  very_active: "very active",
};

/**
 * Caloric net is coloured by deviation only: a deficit and a surplus share one
 * neutral brand accent (they read as "off maintenance"), never good-vs-bad —
 * whether a deficit is desirable depends on the user's cut/bulk goal. The same
 * mapping drives Nutrition/EnergyCard so both energy surfaces agree instead of
 * signalling the same day oppositely.
 */
function energyStatusColor(status: EnergyBalance["status"]): string {
  return status === "surplus" || status === "deficit" ? "var(--accent)" : "var(--ink-2)";
}

function energyStatusWord(status: EnergyBalance["status"]): string {
  return status === "surplus" ? "surplus" : status === "deficit" ? "deficit" : "maintaining";
}

function SegmentCard(props: { title: string; to: string; color: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 4,
              background: props.color,
              marginRight: 8,
            }}
          />
          {props.title}
        </h3>
        <Link className="chip" to={props.to} style={{ textDecoration: "none" }}>
          Open →
        </Link>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {props.children}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [energy, setEnergy] = useState<EnergyBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([dashboardApi.overview(), dashboardApi.history(30), dashboardApi.energy()])
      .then(([o, h, e]) => {
        setOverview(o);
        setHistory(h);
        setEnergy(e);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard"));
  }, []);

  useEffect(reload, [reload]);

  if (error) {
    return (
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="error-text">{error}</p>
        <button className="btn" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  if (!overview || !history || !energy) {
    return (
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="empty">Loading…</p>
      </div>
    );
  }

  const { score } = overview;
  const daily = history.daily;
  const yesterday = daily.length >= 2 ? daily[daily.length - 2] : undefined;
  const delta = yesterday ? score.total - yesterday.total : null;
  const deltaDir = delta == null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const deltaText =
    delta == null ? "no history yet" : `${delta > 0 ? "+" : ""}${delta} vs yesterday`;

  const trendData = daily.map((d) => ({ date: d.date.slice(5), score: d.total }));

  const w = overview.workout;
  const nu = overview.nutrition;
  const wa = overview.water;
  const sl = overview.sleep;
  const vi = overview.vitamins;
  const mo = overview.mobility;
  const wt = overview.weight;

  const workoutStatusLabel =
    w.status === "trained"
      ? "Trained today"
      : w.status === "scheduled"
        ? "Scheduled — not logged yet"
        : "Rest day";

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        {overview.date} — your day across all five segments.
        {overview.goalStatement ? ` Goal: ${overview.goalStatement}` : ""}
      </p>

      {/* Hero: today's score + component tiles */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card stat-tile">
          <span className="label">Today's health score</span>
          <span className="value" style={{ fontSize: 46, color: scoreColor(score.total) }}>
            {score.total}
          </span>
          <span className={`delta ${deltaDir}`}>{deltaText}</span>
        </div>
        <StatTile
          label={`Workout · ${score.weights.workout}%`}
          value={score.workout}
          delta={score.breakdown.workout}
        />
        <StatTile
          label={`Nutrition · ${score.weights.nutrition}%`}
          value={score.nutrition}
          delta={[score.breakdown.nutrition, score.breakdown.water].filter(Boolean).join(" ")}
        />
        <StatTile
          label={`Sleep · ${score.weights.sleep}%`}
          value={score.sleep}
          delta={score.breakdown.sleep}
        />
        <StatTile
          label={`Vitamins · ${score.weights.vitamins}%`}
          value={score.vitamins}
          delta={score.breakdown.vitamins}
        />
        <StatTile
          label={`Mobility · ${score.weights.mobility}%`}
          value={score.mobility}
          delta={score.breakdown.mobility}
        />
      </div>
      <p className="page-sub" style={{ marginTop: 8 }}>
        Each segment starts at 0 each day and climbs as you log. The % on each tile is that
        segment's weight in your total — weighted by your goal (edit in{" "}
        <Link to="/settings" style={{ color: "var(--series-1)" }}>
          Settings
        </Link>
        ).
      </p>

      {/* Energy balance: intake vs baseline (TDEE) + exercise burn */}
      <h2 className="section-title">Energy balance</h2>
      {energy.hasProfile ? (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
          >
            <div className="card stat-tile">
              <span className="label">Net today</span>
              <span
                className="value"
                style={{ fontSize: 38, color: energyStatusColor(energy.status) }}
              >
                {fmtKcal(energy.net ?? 0)}
              </span>
              <span className="delta" style={{ color: energyStatusColor(energy.status) }}>
                {energyStatusWord(energy.status)}
              </span>
            </div>
            <StatTile label="Intake" value={`${Math.round(energy.intakeCalories)} kcal`} delta="eaten" />
            <StatTile
              label={`Baseline · ${
                energy.activityLevel ? ACTIVITY_LABEL[energy.activityLevel] ?? energy.activityLevel : "TDEE"
              }`}
              value={`${Math.round(energy.baselineBurn ?? 0)} kcal`}
              delta={energy.bmr != null ? `BMR ${Math.round(energy.bmr)}` : undefined}
            />
            <StatTile
              label="Exercise burn"
              value={`${Math.round(energy.exerciseBurn)} kcal`}
              delta="logged workouts"
            />
            <StatTile
              label="Total out"
              value={`${Math.round(energy.totalBurn)} kcal`}
              delta="baseline + exercise"
            />
          </div>
          <p className="page-sub" style={{ marginTop: 8 }}>
            Net = intake − (baseline TDEE + exercise). Negative is a deficit. Exercise and strength
            burn are estimates.
          </p>
        </>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>
              Add your age, height, weight &amp; activity in{" "}
              <Link to="/settings" style={{ color: "var(--series-1)" }}>
                Settings
              </Link>{" "}
              to see your baseline burn (TDEE) and caloric net. Intake and exercise burn are shown
              below in the meantime.
            </p>
          </div>
          <StatTile label="Intake" value={`${Math.round(energy.intakeCalories)} kcal`} delta="eaten today" />
          <StatTile
            label="Exercise burn"
            value={`${Math.round(energy.exerciseBurn)} kcal`}
            delta="logged workouts"
          />
        </div>
      )}

      {/* Coordinator chat + score trend */}
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <AgentChat
          agent="master"
          title="Health Coordinator"
          placeholder={
            'Your master coach — it sees every segment and can task the specialist agents. Try "How am I doing today?" or "Plan a dinner that fits my remaining calories and fills my vitamin gaps."'
          }
          onReply={reload}
        />
        <div className="stack">
          <ChartCard title="Health score — last 30 days" sub="Daily total (0-100)">
            <TrendLine
              data={trendData}
              x="date"
              series={[{ key: "score", name: "Health score" }]}
              yDomain={[0, 100]}
              referenceY={{ value: history.monthlyAverage, label: "30-day avg" }}
            />
          </ChartCard>
          <div className="grid cols-2">
            <StatTile
              label="7-day average"
              value={history.weeklyAverage}
              delta={`${history.weeklyAverage >= history.monthlyAverage ? "+" : ""}${
                history.weeklyAverage - history.monthlyAverage
              } vs 30-day`}
              deltaDirection={
                history.weeklyAverage > history.monthlyAverage
                  ? "up"
                  : history.weeklyAverage < history.monthlyAverage
                    ? "down"
                    : "flat"
              }
            />
            <StatTile label="30-day average" value={history.monthlyAverage} />
          </div>
        </div>
      </div>

      {/* Per-segment summaries */}
      <h2 className="section-title">Segments</h2>
      <div className="grid cols-2">
        <SegmentCard title="Workout" to="/workout" color="var(--series-6)">
          <div className="row wrap">
            <span className="chip">{workoutStatusLabel}</span>
            {w.scheduledPlanDays.map((name) => (
              <span key={name} className="chip">
                {name}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {w.sessionCount > 0 || w.cardioCount > 0
              ? `${w.sessionCount} lifting session${w.sessionCount === 1 ? "" : "s"} (${
                  w.setCount
                } sets, ${w.completedSessionCount} completed) · ${w.cardioCount} cardio (${fmtMiles(
                  w.cardioDistanceKm,
                )})`
              : "Nothing logged today."}
          </span>
        </SegmentCard>

        <SegmentCard title="Nutrition" to="/nutrition" color="var(--series-2)">
          <Meter
            label="Calories"
            percent={nu.calorieGoal > 0 ? (nu.calories / nu.calorieGoal) * 100 : 0}
            detail={`${nu.calories} / ${nu.calorieGoal} kcal`}
            color={
              nu.calorieGoal > 0 && nu.calories > nu.calorieGoal * 1.15
                ? "var(--status-serious)"
                : undefined
            }
          />
          <Meter
            label="Protein"
            percent={nu.proteinGoalG > 0 ? (nu.proteinG / nu.proteinGoalG) * 100 : 0}
            detail={`${nu.proteinG} / ${nu.proteinGoalG} g`}
          />
          <Meter
            label="Water"
            percent={wa.goalMl > 0 ? (wa.totalMl / wa.goalMl) * 100 : 0}
            detail={`${Math.round(flozFromMl(wa.totalMl))} / ${fmtFloz(wa.goalMl)}`}
            color="var(--series-5)"
          />
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {nu.mealsLogged > 0
              ? `${nu.mealsLogged} item${nu.mealsLogged === 1 ? "" : "s"} logged`
              : "No food logged today"}
            {" · "}
            {wt.latest != null
              ? `weight ${wt.latest} ${LB} (${wt.date})${
                  wt.goal != null ? `, goal ${wt.goal} ${LB}` : ""
                }`
              : "no weight logged yet"}
          </span>
        </SegmentCard>

        <SegmentCard title="Sleep" to="/sleep" color="var(--series-7)">
          {!sl.logged ? (
            <p className="empty" style={{ padding: 0 }}>
              No sleep logged for today.
            </p>
          ) : sl.inProgress ? (
            <span className="chip">In bed — wake time not logged yet</span>
          ) : (
            <Meter
              label="Last night"
              percent={sl.targetHours > 0 ? ((sl.durationHours ?? 0) / sl.targetHours) * 100 : 0}
              detail={`${sl.durationHours ?? 0} / ${sl.targetHours} h`}
              color="var(--series-7)"
            />
          )}
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            Target {sl.targetHours} h{sl.quality != null ? ` · quality ${sl.quality}/5` : ""}
          </span>
        </SegmentCard>

        <SegmentCard title="Vitamins" to="/vitamins" color="var(--series-5)">
          <Meter
            label="Average coverage"
            percent={vi.averageCoveragePercent}
            detail={`${vi.averageCoveragePercent}%`}
          />
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {vi.nutrientsAtTarget} of {vi.nutrientsTracked} nutrients at target ·{" "}
            {vi.activeSupplements > 0
              ? `${vi.supplementsTaken}/${vi.activeSupplements} supplements taken`
              : "no active supplements"}
          </span>
        </SegmentCard>

        <SegmentCard title="Mobility" to="/mobility" color="var(--series-3)">
          {mo.sessionCount > 0 ? (
            <div className="row wrap">
              <span className="chip">
                {mo.sessionCount} session{mo.sessionCount === 1 ? "" : "s"} · {mo.totalMinutes} min
              </span>
              {mo.kinds.map((k) => (
                <span key={k} className="chip">
                  {k}
                </span>
              ))}
            </div>
          ) : (
            <p className="empty" style={{ padding: 0 }}>
              No stretching, yoga, or posture work logged today.
            </p>
          )}
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {mo.metricsTracked > 0
              ? `${mo.metricsTracked} qualitative metric${mo.metricsTracked === 1 ? "" : "s"} tracked`
              : "No qualitative metrics defined yet."}
          </span>
        </SegmentCard>
      </div>
    </div>
  );
}
