/**
 * Food picker + creator: search the library, log a food to a meal for the
 * active day, or create a new library food (macros + optional micronutrients).
 */
import { useEffect, useMemo, useState } from "react";
import { NUTRIENTS } from "@shared/nutrients";
import type { Food, MealType, MicroMap } from "@shared/types";
import { nutritionApi, type FoodInput } from "../../api/nutrition";
import { MEALS } from "./util";

const EMPTY_FORM = {
  name: "",
  brand: "",
  servingSize: "1",
  servingUnit: "serving",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
  fiberG: "",
  sugarG: "",
  sodiumMg: "",
};

// Fiber is captured by the fiberG macro field; keep it out of the micros grid
// so it isn't double counted by the vitamins coverage math.
const MICRO_DEFS = NUTRIENTS.filter((n) => n.key !== "fiber_g");

/** Sensible meal for the current wall-clock time: <11am breakfast, 11–4 lunch, 4–9pm dinner, else snack. */
function defaultMealForNow(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

// Last meal actually logged this session — wins over the time-of-day default
// until the tab is reloaded (module-level on purpose; survives remounts).
let sessionLastMeal: MealType | null = null;

export function FoodPicker(props: {
  date: string;
  onLogged: () => void;
  reloadKey?: number;
  /** Stage a ready message for the Nutrition coach (pre-fills the draft card). */
  onAskCoach?: (message: string) => void;
}) {
  const [foods, setFoods] = useState<Food[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [servings, setServings] = useState("1");
  const [meal, setMeal] = useState<MealType>(() => sessionLastMeal ?? defaultMealForNow());
  const [showCreate, setShowCreate] = useState(false);
  const [showMicros, setShowMicros] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [micros, setMicros] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFoods = () =>
    nutritionApi
      .foods()
      .then(setFoods)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load foods"));

  useEffect(() => {
    loadFoods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? foods.filter((f) => `${f.name} ${f.brand}`.toLowerCase().includes(q))
      : foods;
    return list.slice(0, 100);
  }, [foods, query]);

  // Resolve against the FULL library, not the filtered slice — editing the
  // search text never silently clears a selection the user already made.
  const selected = foods.find((f) => f.id === selectedId) ?? null;

  // When the search narrows to exactly one food, that's the food — pick it.
  useEffect(() => {
    if (query.trim() !== "" && filtered.length === 1 && selectedId !== filtered[0].id) {
      setSelectedId(filtered[0].id);
    }
  }, [query, filtered, selectedId]);

  // Keep a still-selected food visible in the dropdown even when the current
  // query filters it out.
  const options =
    selected && !filtered.some((f) => f.id === selected.id) ? [selected, ...filtered] : filtered;

  async function logSelected() {
    if (!selected) {
      setError("Pick a food first");
      return;
    }
    const n = Number(servings);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Servings must be a positive number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await nutritionApi.logFood({ date: props.date, foodId: selected.id, servings: n, meal });
      sessionLastMeal = meal; // remember last-used meal for the rest of the session
      setServings("1");
      props.onLogged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log food");
    } finally {
      setBusy(false);
    }
  }

  async function createFood() {
    if (!form.name.trim()) {
      setError("Food name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
    const microMap: MicroMap = {};
    for (const [key, v] of Object.entries(micros)) {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n) && n > 0) microMap[key] = n;
    }
    const input: FoodInput = {
      name: form.name.trim(),
      brand: form.brand.trim(),
      servingSize: num(form.servingSize),
      servingUnit: form.servingUnit.trim() || "serving",
      calories: num(form.calories),
      proteinG: num(form.proteinG),
      carbsG: num(form.carbsG),
      fatG: num(form.fatG),
      fiberG: num(form.fiberG),
      sugarG: num(form.sugarG),
      sodiumMg: num(form.sodiumMg),
      micros: microMap,
    };
    try {
      const food = await nutritionApi.createFood(input);
      await loadFoods();
      setSelectedId(food.id);
      setShowCreate(false);
      setShowMicros(false);
      setForm({ ...EMPTY_FORM });
      setMicros({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create food");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    if (
      !window.confirm(
        `Delete "${selected.name}" from the library? All log entries using it are removed too.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await nutritionApi.deleteFood(selected.id);
      setSelectedId("");
      await loadFoods();
      props.onLogged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete food");
    } finally {
      setBusy(false);
    }
  }

  const setF = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  // Build a ready message and hand it to the coach draft card — does NOT call
  // the API here; the user reviews and sends it themselves.
  function askCoach() {
    const name = form.name.trim();
    if (!name) {
      setError("Enter a food name first, then ask the coach to fill it in");
      return;
    }
    const size = form.servingSize.trim() || "1";
    const unit = form.servingUnit.trim() || "serving";
    const brand = form.brand.trim();
    const label = `${name}${brand ? ` (${brand})` : ""}, ${size} ${unit}`;
    setError(null);
    props.onAskCoach?.(
      `Add "${label}" to my food library — estimate full calories, macros, and micronutrients from its general nutrition profile.`,
    );
  }

  const microsFilled = Object.values(micros).filter((v) => v.trim() !== "").length;

  return (
    <div className="stack">
      <div className="row wrap">
        <label className="field" style={{ flex: 2, minWidth: 150 }}>
          Search food
          <input
            className="input"
            placeholder="banana, oats…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="field" style={{ flex: 3, minWidth: 200 }}>
          Food ({filtered.length})
          <select
            className="input"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— pick a food —</option>
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.brand ? ` (${f.brand})` : ""} · {Math.round(f.calories)} kcal
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 84 }}>
          Servings
          <input
            className="input"
            type="number"
            min={0.25}
            step={0.25}
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </label>
        <label className="field" style={{ width: 118 }}>
          Meal
          <select
            className="input"
            value={meal}
            onChange={(e) => setMeal(e.target.value as MealType)}
          >
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn primary"
          style={{ alignSelf: "flex-end" }}
          onClick={logSelected}
          disabled={busy || !selected}
        >
          Log
        </button>
        <button
          className="btn"
          style={{ alignSelf: "flex-end" }}
          onClick={() => setShowCreate((s) => !s)}
        >
          {showCreate ? "Close" : "New food"}
        </button>
      </div>

      {selected && (
        <div className="row wrap">
          <span className="chip">
            1 serving = {selected.servingSize} {selected.servingUnit}
          </span>
          <span className="chip">{Math.round(selected.calories)} kcal</span>
          <span className="chip">
            P {selected.proteinG}g · C {selected.carbsG}g · F {selected.fatG}g
          </span>
          <span className="chip">{Object.keys(selected.micros).length} micros filled</span>
          <span className="chip">{selected.source === "ai" ? "AI-filled" : "user-entered"}</span>
          <button className="btn small danger" onClick={deleteSelected} disabled={busy}>
            Delete food
          </button>
        </div>
      )}

      {showCreate && (
        <div className="stack" style={{ borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
          <div className="row wrap">
            <label className="field" style={{ flex: 2, minWidth: 160 }}>
              Name
              <input className="input" value={form.name} onChange={setF("name")} placeholder="Banana (medium)" />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 110 }}>
              Brand
              <input className="input" value={form.brand} onChange={setF("brand")} />
            </label>
            <label className="field" style={{ width: 100 }}>
              Serving size
              <input className="input" type="number" min={0.001} value={form.servingSize} onChange={setF("servingSize")} />
            </label>
            <label className="field" style={{ width: 100 }}>
              Unit
              <input className="input" value={form.servingUnit} onChange={setF("servingUnit")} placeholder="g" />
            </label>
          </div>
          <div className="row wrap">
            <label className="field" style={{ width: 96 }}>
              Calories
              <input className="input" type="number" min={0} value={form.calories} onChange={setF("calories")} />
            </label>
            <label className="field" style={{ width: 96 }}>
              Protein (g)
              <input className="input" type="number" min={0} value={form.proteinG} onChange={setF("proteinG")} />
            </label>
            <label className="field" style={{ width: 96 }}>
              Carbs (g)
              <input className="input" type="number" min={0} value={form.carbsG} onChange={setF("carbsG")} />
            </label>
            <label className="field" style={{ width: 96 }}>
              Fat (g)
              <input className="input" type="number" min={0} value={form.fatG} onChange={setF("fatG")} />
            </label>
            <label className="field" style={{ width: 96 }}>
              Fiber (g)
              <input className="input" type="number" min={0} value={form.fiberG} onChange={setF("fiberG")} />
            </label>
            <label className="field" style={{ width: 96 }}>
              Sugar (g)
              <input className="input" type="number" min={0} value={form.sugarG} onChange={setF("sugarG")} />
            </label>
            <label className="field" style={{ width: 104 }}>
              Sodium (mg)
              <input className="input" type="number" min={0} value={form.sodiumMg} onChange={setF("sodiumMg")} />
            </label>
          </div>
          <div>
            <button className="btn small" onClick={() => setShowMicros((s) => !s)}>
              {showMicros ? "Hide micronutrients" : `Micronutrients (${microsFilled} filled)`}
            </button>
          </div>
          {showMicros && (
            <div className="grid cols-3">
              {MICRO_DEFS.map((n) => (
                <label key={n.key} className="field">
                  {n.label} ({n.unit})
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={micros[n.key] ?? ""}
                    onChange={(e) => setMicros({ ...micros, [n.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="row wrap">
            <button className="btn primary" onClick={createFood} disabled={busy}>
              Create food
            </button>
            {props.onAskCoach && (
              <button className="btn" onClick={askCoach} disabled={busy}>
                Ask the coach to fill this in
              </button>
            )}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Enter a name (and serving) then let the coach estimate full macros and
              micronutrients — or fill the fields in yourself.
            </span>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
