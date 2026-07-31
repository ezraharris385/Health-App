/**
 * Nutrition page, ordered by what a mid-day user does most: goal tiles (with
 * built-in progress bars) → meal log → water → weight quick-entry → compact
 * energy strip → 30-day history charts → the nutrition agent chat.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyNutritionSummary, EnergyBalance } from "@shared/types";
import { AgentChat } from "../../components/AgentChat";
import { todayStr } from "../../api/http";
import { dashboardApi } from "../../api/dashboard";
import {
  nutritionApi,
  type MacroHistoryResponse,
  type SupplementMacroContribution,
  type WaterHistoryResponse,
  type WaterSummary,
  type WeightHistoryResponse,
} from "../../api/nutrition";
import { FLOZ, flozFromMl } from "../../units";
import { ChartCard, HistoryBars, Legend, SERIES } from "../../viz/ChartKit";
import { CoachDraftCard } from "./CoachDraftCard";
import { EnergyCard } from "./EnergyCard";
import { MealLogCard } from "./MealLogCard";
import { WaterCard } from "./WaterCard";
import { WeightCard } from "./WeightCard";
import { fmtDay, r1 } from "./util";

export default function NutritionPage() {
  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState<DailyNutritionSummary | null>(null);
  const [history, setHistory] = useState<MacroHistoryResponse | null>(null);
  const [water, setWater] = useState<WaterSummary | null>(null);
  const [waterHistory, setWaterHistory] = useState<WaterHistoryResponse | null>(null);
  const [weight, setWeight] = useState<WeightHistoryResponse | null>(null);
  const [energy, setEnergy] = useState<EnergyBalance | null>(null);
  const [suppMacros, setSuppMacros] = useState<SupplementMacroContribution | null>(null);
  const [coachDraft, setCoachDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dateRef = useRef(date);
  dateRef.current = date;

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
    Promise.all([
      nutritionApi.summary(date),
      nutritionApi.history(30),
      nutritionApi.water(date),
      nutritionApi.waterHistory(30),
      nutritionApi.weight(90),
      dashboardApi.energy(date),
      nutritionApi.supplementMacros(date),
    ])
      .then(([s, h, w, wh, wt, en, sm]) => {
        if (dateRef.current !== date) return;
        setSummary(s);
        setHistory(h);
        setWater(w);
        setWaterHistory(wh);
        setWeight(wt);
        setEnergy(en);
        setSuppMacros(sm);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load nutrition data"),
      );
  }, [date]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totals = summary?.totals;
  const goals = summary?.goals ?? history?.goals ?? null;

  const tiles = [
    {
      label: "Calories (kcal)",
      value: Math.round(totals?.calories ?? 0),
      goal: goals?.calorieGoal ?? 0,
      overIsGood: false,
    },
    {
      label: "Protein (g)",
      value: r1(totals?.proteinG ?? 0),
      goal: goals?.proteinGoalG ?? 0,
      overIsGood: true,
    },
    {
      label: "Carbs (g)",
      value: r1(totals?.carbsG ?? 0),
      goal: goals?.carbsGoalG ?? 0,
      overIsGood: false,
    },
    {
      label: "Fat (g)",
      value: r1(totals?.fatG ?? 0),
      goal: goals?.fatGoalG ?? 0,
      overIsGood: false,
    },
  ];

  const calData = (history?.days ?? []).map((d) => ({
    day: fmtDay(d.date),
    calories: d.calories,
  }));
  const macroData = (history?.days ?? []).map((d) => ({
    day: fmtDay(d.date),
    proteinG: d.proteinG,
    carbsG: d.carbsG,
    fatG: d.fatG,
  }));
  const waterData = (waterHistory?.days ?? []).map((d) => ({
    day: fmtDay(d.date),
    totalFloz: r1(flozFromMl(d.totalMl)),
  }));

  return (
    <div>
      <div className="row between">
        <div>
          <h1 className="page-title">Nutrition</h1>
          <p className="page-sub">
            Food log, water, and weight vs your goals — the assistant can log and recommend for
            you.
          </p>
        </div>
        <label className="field">
          Day
          <input
            className="input"
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}

      {/* Goal tiles double as the day-vs-goals view: value / goal, a slim
          progress bar (plain divs — theme tokens only), and remaining/over. */}
      <div className="grid cols-4">
        {tiles.map((t) => {
          const over = t.goal > 0 && Number(t.value) > t.goal;
          const remaining = r1(t.goal - Number(t.value));
          const pct =
            t.goal > 0 ? Math.max(0, Math.min(100, (Number(t.value) / t.goal) * 100)) : 0;
          const barColor = over
            ? t.overIsGood
              ? "var(--status-good)"
              : "var(--series-4)"
            : "var(--accent)";
          return (
            <div key={t.label} className="card stat-tile">
              <span className="label">{t.label}</span>
              <span className="value">
                {t.value} / {t.goal}
              </span>
              <div
                aria-hidden
                style={{
                  height: 5,
                  borderRadius: 3,
                  margin: "3px 0",
                  background: "color-mix(in srgb, var(--ink) 8%, transparent)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    borderRadius: 3,
                    background: barColor,
                  }}
                />
              </div>
              {t.goal > 0 && (
                <span className={`delta ${over ? (t.overIsGood ? "up" : "down") : ""}`}>
                  {over ? `${r1(-remaining)} over goal` : `${remaining} left`}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <MealLogCard
          summary={summary}
          date={date}
          onChange={reload}
          reloadKey={reloadKey}
          onAskCoach={setCoachDraft}
          suppMacros={suppMacros}
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <WaterCard water={water} date={date} onChange={reload} />
        <WeightCard weight={weight} date={date} onChange={reload} />
      </div>

      <div style={{ marginTop: 14 }}>
        <EnergyCard energy={energy} date={date} />
      </div>

      <h2 className="section-title">History</h2>
      <div className="grid cols-2">
        <ChartCard title="Calories — last 30 days" sub="Daily intake vs your calorie goal">
          <HistoryBars
            data={calData}
            x="day"
            bars={[{ key: "calories", name: "Calories" }]}
            unit="kcal"
            referenceY={goals ? { value: goals.calorieGoal, label: "goal" } : undefined}
          />
        </ChartCard>
        <ChartCard title="Macros — last 30 days" sub="Grams of protein, carbs, and fat per day">
          <HistoryBars
            data={macroData}
            x="day"
            stacked
            bars={[
              { key: "proteinG", name: "Protein" },
              { key: "carbsG", name: "Carbs" },
              { key: "fatG", name: "Fat" },
            ]}
            unit="g"
          />
          <Legend
            items={[
              { name: "Protein", color: SERIES[0] },
              { name: "Carbs", color: SERIES[1] },
              { name: "Fat", color: SERIES[2] },
            ]}
          />
        </ChartCard>
        <ChartCard title="Water — last 30 days" sub="Daily total vs your water goal">
          <HistoryBars
            data={waterData}
            x="day"
            bars={[{ key: "totalFloz", name: "Water", color: "var(--series-5)" }]}
            unit={FLOZ}
            referenceY={
              waterHistory
                ? { value: r1(flozFromMl(waterHistory.goalMl)), label: "goal" }
                : undefined
            }
          />
        </ChartCard>
      </div>

      <h2 className="section-title">Assistant</h2>
      {coachDraft !== null && (
        <div style={{ marginBottom: 14 }}>
          <CoachDraftCard
            draft={coachDraft}
            onSent={() => setCoachDraft(null)}
            onDismiss={() => setCoachDraft(null)}
          />
        </div>
      )}
      <AgentChat
        agent="nutrition"
        title="Nutrition Assistant"
        placeholder='Try: "log a banana and 2 eggs for breakfast", "what should I eat for dinner?", or "set my calorie goals from my profile".'
        onReply={reload}
      />
    </div>
  );
}
