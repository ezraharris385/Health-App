/**
 * Per-meal food log for the active day: food picker/creator on top, then the
 * day's entries grouped by meal with per-meal calorie subtotals, and a footer
 * with the day's fiber/sugar/sodium totals (plus any supplement contribution
 * disclosure so the tiles reconcile against the food-only log).
 */
import { Fragment } from "react";
import type { DailyNutritionSummary } from "@shared/types";
import { nutritionApi, type SupplementMacroContribution } from "../../api/nutrition";
import { FoodPicker } from "./FoodPicker";
import { MEALS, fmtDateShort, r1 } from "./util";

export function MealLogCard(props: {
  summary: DailyNutritionSummary | null;
  date: string;
  onChange: () => void;
  reloadKey?: number;
  onAskCoach?: (message: string) => void;
  suppMacros?: SupplementMacroContribution | null;
}) {
  const s = props.summary;
  const totals = s?.totals;

  // Every nonzero macro a taken supplement adds to today's totals — disclosed so
  // the day-vs-goals numbers reconcile against the food-only meal log (a 0-kcal
  // electrolyte tablet still moves Sodium, which must be attributable).
  const sm = props.suppMacros;
  const suppParts = sm
    ? [
        sm.calories > 0 ? `${Math.round(sm.calories)} kcal` : null,
        sm.proteinG > 0 ? `+${r1(sm.proteinG)}g protein` : null,
        sm.carbsG > 0 ? `+${r1(sm.carbsG)}g carbs` : null,
        sm.fatG > 0 ? `+${r1(sm.fatG)}g fat` : null,
        sm.sugarG > 0 ? `+${r1(sm.sugarG)}g sugar` : null,
        sm.sodiumMg > 0 ? `+${Math.round(sm.sodiumMg)}mg sodium` : null,
      ].filter((p): p is string => p !== null)
    : [];

  async function remove(id: number) {
    try {
      await nutritionApi.deleteLog(id);
    } finally {
      props.onChange();
    }
  }

  return (
    <div className="card">
      <h3>Meal log — {fmtDateShort(props.date)}</h3>
      <FoodPicker
        date={props.date}
        onLogged={props.onChange}
        reloadKey={props.reloadKey}
        onAskCoach={props.onAskCoach}
      />

      {s && s.logs.length > 0 ? (
        <table className="data" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Meal</th>
              <th>Food</th>
              <th>Serving</th>
              <th>kcal</th>
              <th>Protein</th>
              <th>Carbs</th>
              <th>Fat</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {MEALS.map((meal) => {
              const logs = s.logs.filter((l) => l.meal === meal);
              if (logs.length === 0) return null;
              return (
                <Fragment key={meal}>
                  {logs.map((l, i) => (
                    <tr key={l.id}>
                      <td>
                        {i === 0 ? (
                          <span className="chip">
                            {meal} · {Math.round(s.byMeal[meal].calories)} kcal
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {l.food?.name ?? `food #${l.foodId}`}
                        {l.food?.brand ? (
                          <span style={{ color: "var(--muted)" }}> · {l.food.brand}</span>
                        ) : null}
                      </td>
                      <td>
                        {l.servings} × {l.food?.servingSize ?? "?"} {l.food?.servingUnit ?? ""}
                      </td>
                      <td>{Math.round((l.food?.calories ?? 0) * l.servings)}</td>
                      <td>{r1((l.food?.proteinG ?? 0) * l.servings)}g</td>
                      <td>{r1((l.food?.carbsG ?? 0) * l.servings)}g</td>
                      <td>{r1((l.food?.fatG ?? 0) * l.servings)}g</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn small danger" onClick={() => remove(l.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="empty">
          Nothing logged for this day yet — pick a food above, or ask the assistant ("log 2 eggs
          for breakfast").
        </p>
      )}

      {totals && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
          Day totals: Fiber {r1(totals.fiberG)}g · Sugar {r1(totals.sugarG)}g · Sodium{" "}
          {Math.round(totals.sodiumMg)}mg
        </p>
      )}
      {sm && suppParts.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
          incl. {suppParts.join(" · ")} from {sm.count} supplement
          {sm.count === 1 ? "" : "s"} taken
        </p>
      )}
    </div>
  );
}
