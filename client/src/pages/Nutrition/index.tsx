/**
 * Nutrition page: daily summary vs goals (StatTiles + macro meters), per-meal
 * food log with picker/creator, in-depth water tracking, weight trend, 30-day
 * calorie/macro/water history charts, and the nutrition agent chat.
 */
import { useCallback, useEffect, useState } from "react";
import type { DailyNutritionSummary } from "@shared/types";
import { AgentChat } from "../../components/AgentChat";
import { todayStr } from "../../api/http";
import {
  nutritionApi,
  type MacroHistoryResponse,
  type WaterHistoryResponse,
  type WaterSummary,
  type WeightHistoryResponse,
} from "../../api/nutrition";
import { ChartCard, HistoryBars, Legend, Meter, SERIES, StatTile } from "../../viz/ChartKit";
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
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      nutritionApi.summary(date),
      nutritionApi.history(30),
      nutritionApi.water(date),
      nutritionApi.waterHistory(30),
      nutritionApi.weight(90),
    ])
      .then(([s, h, w, wh, wt]) => {
        setSummary(s);
        setHistory(h);
        setWater(w);
        setWaterHistory(wh);
        setWeight(wt);
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
    totalMl: d.totalMl,
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

      <div className="grid cols-4">
        {tiles.map((t) => {
          const over = t.goal > 0 && Number(t.value) > t.goal;
          const remaining = r1(t.goal - Number(t.value));
          return (
            <StatTile
              key={t.label}
              label={t.label}
              value={`${t.value} / ${t.goal}`}
              delta={
                t.goal > 0 ? (over ? `${r1(-remaining)} over goal` : `${remaining} left`) : undefined
              }
              deltaDirection={over ? (t.overIsGood ? "up" : "down") : "flat"}
            />
          );
        })}
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Today vs goals — {date}</h3>
          {goals && totals ? (
            <div className="stack">
              <Meter
                label="Calories"
                percent={(totals.calories / Math.max(1, goals.calorieGoal)) * 100}
                detail={`${Math.round(totals.calories)} / ${goals.calorieGoal} kcal`}
              />
              <Meter
                label="Protein"
                percent={(totals.proteinG / Math.max(1, goals.proteinGoalG)) * 100}
                detail={`${r1(totals.proteinG)} / ${goals.proteinGoalG} g`}
              />
              <Meter
                label="Carbs"
                percent={(totals.carbsG / Math.max(1, goals.carbsGoalG)) * 100}
                detail={`${r1(totals.carbsG)} / ${goals.carbsGoalG} g`}
              />
              <Meter
                label="Fat"
                percent={(totals.fatG / Math.max(1, goals.fatGoalG)) * 100}
                detail={`${r1(totals.fatG)} / ${goals.fatGoalG} g`}
              />
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                Fiber {r1(totals.fiberG)}g · Sugar {r1(totals.sugarG)}g · Sodium{" "}
                {Math.round(totals.sodiumMg)}mg
              </p>
            </div>
          ) : (
            <p className="empty">Loading…</p>
          )}
        </div>
        <WaterCard water={water} date={date} onChange={reload} />
      </div>

      <div style={{ marginTop: 14 }}>
        <MealLogCard summary={summary} date={date} onChange={reload} />
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
      </div>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <ChartCard title="Water — last 30 days" sub="Daily total vs your water goal">
          <HistoryBars
            data={waterData}
            x="day"
            bars={[{ key: "totalMl", name: "Water", color: "var(--series-5)" }]}
            unit="ml"
            referenceY={
              waterHistory ? { value: waterHistory.goalMl, label: "goal" } : undefined
            }
          />
        </ChartCard>
        <WeightCard weight={weight} date={date} onChange={reload} />
      </div>

      <h2 className="section-title">Assistant</h2>
      <AgentChat
        agent="nutrition"
        title="Nutrition Assistant"
        placeholder='Try: "log a banana and 2 eggs for breakfast", "what should I eat for dinner?", or "set my calorie goals from my profile".'
        onReply={reload}
      />
    </div>
  );
}
