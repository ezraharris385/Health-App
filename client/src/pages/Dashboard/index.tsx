import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { EnergyBalance, ScoreHistory } from "@shared/types";
import { dashboardApi, type DashboardOverview } from "../../api/dashboard";
import { AgentChat } from "../../components/AgentChat";
import { ChartCard, Meter, StatTile, TrendLine } from "../../viz/ChartKit";
import { LB, fmtFloz, fmtMiles, flozFromMl } from "../../units";

const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: "sedentary",
  light: "lightly active",
  moderate: "moderately active",
  active: "active",
  very_active: "very active",
};

/** date − 1 day for a YYYY-MM-DD string (local calendar). */
function yesterdayStr(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Compact score tile: label + number + one-line note. The day is still in
 * progress, so the value renders in neutral ink/accent — never a red "failing
 * grade" mid-day.
 */
function ScoreTile(props: {
  label: string;
  value: ReactNode;
  note?: string;
  valueColor?: string;
  valueSize?: number;
  noteWrap?: boolean;
}) {
  return (
    <div className="card stat-tile">
      <span className="label">{props.label}</span>
      <span className="value" style={{ fontSize: props.valueSize ?? 24, color: props.valueColor }}>
        {props.value}
      </span>
      {props.note && (
        <span
          className="delta"
          title={props.note}
          style={
            props.noteWrap
              ? undefined
              : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
          }
        >
          {props.note}
        </span>
      )}
    </div>
  );
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
  const [showScoreHelp, setShowScoreHelp] = useState(false);

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

  // The dashboard always shows TODAY — an unfinished day. The hero stays
  // neutral ("so far today") and compares against yesterday's *final* score
  // as plain information, not a win/loss delta.
  const yesterday = daily.find((d) => d.date === yesterdayStr(overview.date));
  const heroNote = yesterday
    ? `So far today · yesterday finished at ${yesterday.total}`
    : "So far today";

  // Honest average labels: the engine averages only finished days from the
  // first day with any log; mirror that count here.
  const finishedDays = daily.filter((d) => d.date !== overview.date).length;
  const n7 = Math.min(7, finishedDays);
  const n30 = Math.min(30, finishedDays);

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

  // Mid-day energy framing: food so far vs the full-day burn estimate.
  const roomLeft = Math.round(energy.totalBurn - energy.intakeCalories);

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        {overview.date} — your day across all six areas.
        {overview.goalStatement ? ` Goal: ${overview.goalStatement}` : ""}
      </p>

      {/* Today's score: hero + five segment tiles, compact 2-per-row */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <ScoreTile
          label="Health score"
          value={score.total}
          valueColor="var(--accent)"
          valueSize={30}
          note={heroNote}
          noteWrap
        />
        <ScoreTile
          label={`Workout · ${score.weights.workout}%`}
          value={score.workout}
          note={score.breakdown.workout}
        />
        <ScoreTile
          label={`Nutrition · ${score.weights.nutrition}%`}
          value={score.nutrition}
          note={[score.breakdown.nutrition, score.breakdown.water].filter(Boolean).join(" ")}
        />
        <ScoreTile
          label={`Sleep · ${score.weights.sleep}%`}
          value={score.sleep}
          note={score.breakdown.sleep}
        />
        <ScoreTile
          label={`Vitamins · ${score.weights.vitamins}%`}
          value={score.vitamins}
          note={score.breakdown.vitamins}
        />
        <ScoreTile
          label={`Mobility · ${score.weights.mobility}%`}
          value={score.mobility}
          note={score.breakdown.mobility}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="chip"
          onClick={() => setShowScoreHelp((v) => !v)}
          aria-expanded={showScoreHelp}
          style={{ cursor: "pointer" }}
        >
          (?) {showScoreHelp ? "Hide" : "How scores work"}
        </button>
      </div>
      {showScoreHelp && (
        <p className="page-sub" style={{ marginTop: 8 }}>
          Each segment starts at 0 each day and climbs as you log. The % on each tile is that
          segment's weight in your total — weighted by your goal (edit in{" "}
          <Link to="/settings" style={{ color: "var(--series-1)" }}>
            Settings
          </Link>
          ).
        </p>
      )}

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

      {/* Score trend + honest averages */}
      <h2 className="section-title">Trend</h2>
      <div className="stack">
        <ChartCard
          title="Health score"
          sub={`Daily total (0-100) · ${daily.length} day${daily.length === 1 ? "" : "s"} since your first log`}
        >
          <TrendLine
            data={trendData}
            x="date"
            series={[{ key: "score", name: "Health score" }]}
            yDomain={[0, 100]}
            referenceY={{ value: history.monthlyAverage, label: "30-day avg" }}
          />
        </ChartCard>
        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <StatTile
            label={`7-day average (${n7} logged day${n7 === 1 ? "" : "s"})`}
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
          <StatTile
            label={`30-day average (${n30} logged day${n30 === 1 ? "" : "s"})`}
            value={history.monthlyAverage}
          />
        </div>
      </div>

      {/* Energy: food so far vs full-day burn (the day isn't over yet) */}
      <h2 className="section-title">Energy balance</h2>
      {energy.hasProfile ? (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
          >
            <div className="card stat-tile">
              <span className="label">
                {roomLeft >= 0 ? "Room left today" : "Over your full-day burn"}
              </span>
              <span className="value" style={{ fontSize: 34, color: "var(--accent)" }}>
                {Math.abs(roomLeft)} kcal
              </span>
              <span className="delta">food so far vs full-day burn (est.)</span>
            </div>
            <StatTile
              label="Intake"
              value={`${Math.round(energy.intakeCalories)} kcal`}
              delta="food so far"
            />
            <StatTile
              label="At rest + daily activity"
              value={`${Math.round(energy.baselineBurn ?? 0)} kcal`}
              delta={`est.${energy.bmr != null ? ` — resting ${Math.round(energy.bmr)} kcal` : ""}${
                energy.activityLevel
                  ? `, ${ACTIVITY_LABEL[energy.activityLevel] ?? energy.activityLevel}`
                  : ""
              }`}
            />
            <StatTile
              label="Exercise burn"
              value={`${Math.round(energy.exerciseBurn)} kcal`}
              delta="logged workouts"
            />
            <StatTile
              label="Full-day burn"
              value={`${Math.round(energy.totalBurn)} kcal`}
              delta="at rest + activity + exercise (est.)"
            />
          </div>
          <p className="page-sub" style={{ marginTop: 8 }}>
            Room left = your full-day burn (at rest + daily activity + exercise) minus food logged
            so far. Burn numbers are estimates.
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
              to see your full-day burn and how much room you have left today. Intake and exercise
              burn are shown below in the meantime.
            </p>
          </div>
          <StatTile
            label="Intake"
            value={`${Math.round(energy.intakeCalories)} kcal`}
            delta="food so far"
          />
          <StatTile
            label="Exercise burn"
            value={`${Math.round(energy.exerciseBurn)} kcal`}
            delta="logged workouts"
          />
        </div>
      )}

      {/* Coordinator chat — after the numbers, so the day's context comes first */}
      <h2 className="section-title">Ask your coach</h2>
      <AgentChat
        agent="master"
        title="Health Coordinator"
        placeholder={
          'Your master coach — it sees every segment and can task the specialist agents. Try "How am I doing today?" or "Plan a dinner that fits my remaining calories and fills my vitamin gaps."'
        }
        onReply={reload}
      />
    </div>
  );
}
