import { Suspense, lazy, useEffect, useState } from "react";
import { settingsApi } from "../../api/settings";
import { nutritionApi, type WeightHistoryResponse } from "../../api/nutrition";
import { todayStr } from "../../api/http";
import {
  cmFromFtIn,
  ftInFromCm,
  flozFromMl,
  mlFromFloz,
} from "../../units";
import type { Settings } from "@shared/types";
import {
  SCORE_PRESETS,
  SEGMENT_KEYS,
  normalizeWeights,
  type ScoreSegment,
} from "@shared/data/scoreWeights";

// Local-mode-only cards (API key + backups). The build-time constant makes
// this dead code in server mode, so the local runtime never gets bundled.
const LocalCards =
  import.meta.env.VITE_LOCAL_MODE === "1" ? lazy(() => import("./LocalCards")) : null;

// Plausible human-height bounds (canonical cm) guarding the ft/in entry. A
// partially-cleared height (e.g. blank feet + a few inches) otherwise coerces
// to a nonsensical value that would silently feed BMR/TDEE on the dashboard.
const MIN_HEIGHT_CM = cmFromFtIn(2, 0); // 60.96 cm (2 ft)
const MAX_HEIGHT_CM = cmFromFtIn(9, 0); // 274.32 cm (9 ft)

// Friendly labels for the stored activity enum → these drive the TDEE multiplier.
const ACTIVITY_OPTIONS: { value: NonNullable<Settings["profile"]["activityLevel"]>; label: string }[] = [
  { value: "sedentary", label: "Sedentary (little/no exercise)" },
  { value: "light", label: "Lightly active (1–3 days/wk)" },
  { value: "moderate", label: "Moderately active (3–5 days/wk)" },
  { value: "active", label: "Active (6–7 days/wk)" },
  { value: "very_active", label: "Very active (hard daily / physical job)" },
];

// Display labels for the five scored segments (raw weight order = SEGMENT_KEYS).
const SEGMENT_LABELS: Record<ScoreSegment, string> = {
  workout: "Workout",
  nutrition: "Nutrition",
  sleep: "Sleep",
  vitamins: "Vitamins",
  mobility: "Mobility",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Imperial edit-buffers derived from the canonical (metric) storage. Kept as
  // strings so the inputs type freely; converted back on save.
  const [ft, setFt] = useState("");
  const [inch, setInch] = useState("");
  const [waterFloz, setWaterFloz] = useState("");

  // Current weight (logs to weight_logs via the nutrition endpoint — canonical lb).
  const [weightData, setWeightData] = useState<WeightHistoryResponse | null>(null);
  const [weightInput, setWeightInput] = useState("");
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightSaved, setWeightSaved] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);

  function seedDerived(s: Settings) {
    if (s.profile.heightCm != null && s.profile.heightCm > 0) {
      const h = ftInFromCm(s.profile.heightCm);
      setFt(String(h.ft));
      setInch(String(h.inch));
    } else {
      setFt("");
      setInch("");
    }
    setWaterFloz(String(Math.round(flozFromMl(s.goals.waterGoalMl))));
  }

  const reloadWeight = () => nutritionApi.weight(90).then(setWeightData).catch(() => {});

  useEffect(() => {
    settingsApi
      .get()
      .then((s) => {
        setSettings(s);
        seedDerived(s);
      })
      .catch((e) => setError(e.message));
    reloadWeight();
  }, []);

  if (!settings) {
    return error ? <p className="error-text">{error}</p> : <p className="empty">Loading…</p>;
  }

  const g = settings.goals;
  const p = settings.profile;

  const setGoal = (key: keyof Settings["goals"], value: unknown) =>
    setSettings({ ...settings, goals: { ...g, [key]: value } });
  const setProfile = (key: keyof Settings["profile"], value: unknown) =>
    setSettings({ ...settings, profile: { ...p, [key]: value } });

  const num = (v: string) => (v === "" ? null : Number(v));

  // Daily-score weights. Raw points live in settings.scoreWeights; the live
  // share below each input is what scoring actually uses (raw/Σraw, normalized).
  const sw = settings.scoreWeights;
  const goalPreset = settings.scoreGoalPreset;
  const shares = normalizeWeights(sw);
  // When every raw weight is 0, normalizeWeights falls back to the Balanced
  // defaults — so the shares below (and the score) show 22/28/… while the inputs
  // read 0. Surface that so the displayed % doesn't silently contradict the input.
  const rawWeightTotal = SEGMENT_KEYS.reduce((sum, seg) => sum + (Number(sw[seg]) || 0), 0);
  const usingDefaultWeights = rawWeightTotal <= 0;

  // Editing any raw weight makes the weight set "custom"; picking a preset both
  // replaces the weights and re-tags the preset.
  const setWeight = (seg: ScoreSegment, raw: number) =>
    setSettings({
      ...settings,
      scoreWeights: { ...sw, [seg]: raw },
      scoreGoalPreset: "custom",
    });
  const applyPreset = (key: string) => {
    const preset = SCORE_PRESETS[key];
    if (!preset) {
      // "Custom" chosen explicitly — keep the current weights, just re-tag.
      setSettings({ ...settings, scoreGoalPreset: "custom" });
      return;
    }
    setSettings({
      ...settings,
      scoreWeights: { ...preset.weights },
      scoreGoalPreset: key,
    });
  };

  async function save() {
    // Height: convert ft + in → cm. Empty both = cleared (null). Otherwise both
    // treated as 0 when blank; reject a zero/negative height.
    let heightCm: number | null = null;
    if (ft.trim() !== "" || inch.trim() !== "") {
      const ftN = ft.trim() === "" ? 0 : Number(ft);
      const inN = inch.trim() === "" ? 0 : Number(inch);
      if (
        !Number.isFinite(ftN) ||
        !Number.isFinite(inN) ||
        ftN < 0 ||
        inN < 0 ||
        (ftN === 0 && inN === 0)
      ) {
        setError("Enter a valid height (feet and inches).");
        return;
      }
      const cm = cmFromFtIn(ftN, inN);
      // Plausibility bound: reject a partially-cleared or typo'd height (e.g.
      // blank feet + "10" in → 25.4 cm) before it silently feeds BMR/TDEE.
      if (cm < MIN_HEIGHT_CM || cm > MAX_HEIGHT_CM) {
        setError("Enter a realistic height (2–9 ft).");
        return;
      }
      heightCm = cm;
    }

    // Water goal is entered in fl oz, stored in ml. Must be a positive number.
    const flozN = Number(waterFloz);
    if (waterFloz.trim() === "" || !Number.isFinite(flozN) || flozN <= 0) {
      setError("Water goal must be a positive number of fl oz.");
      return;
    }
    // The fl oz buffer is a rounded view of the canonical ml goal, so a no-op
    // Save must not rewrite (and drift) the stored value: keep the original ml
    // when the field still matches what seedDerived displayed.
    const waterGoalMl =
      waterFloz === String(Math.round(flozFromMl(g.waterGoalMl)))
        ? g.waterGoalMl
        : Math.round(mlFromFloz(flozN));

    // Guard the always-required numeric goals: Number("") === 0 and a zero goal
    // breaks every score computation downstream.
    const required: [string, number][] = [
      ["Calories", g.calorieGoal],
      ["Protein", g.proteinGoalG],
      ["Carbs", g.carbsGoalG],
      ["Fat", g.fatGoalG],
      ["Sleep target", g.sleepTargetHours],
    ];
    for (const [label, value] of required) {
      if (!Number.isFinite(value) || value <= 0) {
        setError(`${label} must be a positive number.`);
        return;
      }
    }
    if (p.age != null && (!Number.isFinite(p.age) || p.age <= 0)) {
      setError("Age must be a positive number.");
      return;
    }
    if (g.weightGoal != null && (!Number.isFinite(g.weightGoal) || g.weightGoal <= 0)) {
      setError("Goal weight must be a positive number.");
      return;
    }

    setError(null);
    try {
      // Imperial only: weight is always lb (the old kg/lb toggle is gone).
      const patch: Partial<Settings> = {
        profile: { ...p, heightCm },
        goals: { ...g, waterGoalMl, weightUnit: "lb" },
        scoreWeights: sw,
        scoreGoalPreset: goalPreset,
      };
      const next = await settingsApi.save(patch);
      setSettings(next);
      seedDerived(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function logWeight() {
    const n = Number(weightInput);
    if (!Number.isFinite(n) || n <= 0) {
      setWeightError("Enter your weight in lb.");
      return;
    }
    setWeightBusy(true);
    setWeightError(null);
    try {
      await nutritionApi.logWeight({ date: todayStr(), weight: n });
      setWeightInput("");
      await reloadWeight();
      setWeightSaved(true);
      setTimeout(() => setWeightSaved(false), 1600);
    } catch (e) {
      setWeightError(e instanceof Error ? e.message : "Failed to log weight");
    } finally {
      setWeightBusy(false);
    }
  }

  const entries = weightData?.entries ?? [];
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Your body profile and daily goals — your coaches, scores, and calorie balance use these.
        All units are imperial.
      </p>

      <div className="grid cols-2">
        <div className="card">
          <h3>Body profile</h3>
          <p className="card-sub">
            Age, height, sex, and activity power your estimated daily burn at rest + activity,
            shown on the dashboard.
          </p>
          <div className="stack">
            <label className="field">
              Name
              <input
                className="input"
                value={p.name}
                onChange={(e) => setProfile("name", e.target.value)}
              />
            </label>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Age
                <input
                  className="input"
                  type="number"
                  min={1}
                  placeholder="—"
                  value={p.age ?? ""}
                  onChange={(e) => setProfile("age", num(e.target.value))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Sex
                <select
                  className="input"
                  value={p.sex ?? ""}
                  onChange={(e) => setProfile("sex", e.target.value || null)}
                >
                  <option value="">—</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <div className="field">
              Height
              <div className="row">
                <div className="row" style={{ flex: 1, gap: 6 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="ft"
                    style={{ flex: 1 }}
                    value={ft}
                    onChange={(e) => setFt(e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>ft</span>
                </div>
                <div className="row" style={{ flex: 1, gap: 6 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={11}
                    placeholder="in"
                    style={{ flex: 1 }}
                    value={inch}
                    onChange={(e) => setInch(e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>in</span>
                </div>
              </div>
            </div>
            <label className="field">
              Activity level
              <select
                className="input"
                value={p.activityLevel ?? ""}
                onChange={(e) => setProfile("activityLevel", e.target.value || null)}
              >
                <option value="">—</option>
                {ACTIVITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Notes for your coaches (injuries, preferences, context)
              <textarea
                className="input"
                rows={3}
                value={p.notes}
                onChange={(e) => setProfile("notes", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="card">
          <h3>Daily goals</h3>
          <p className="card-sub">Targets your scores and coaches track against each day.</p>
          <div className="stack">
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Calories (kcal)
                <input
                  className="input"
                  type="number"
                  value={g.calorieGoal}
                  onChange={(e) => setGoal("calorieGoal", Number(e.target.value))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Water (fl oz)
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={waterFloz}
                  onChange={(e) => setWaterFloz(e.target.value)}
                />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Protein (g)
                <input
                  className="input"
                  type="number"
                  value={g.proteinGoalG}
                  onChange={(e) => setGoal("proteinGoalG", Number(e.target.value))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Carbs (g)
                <input
                  className="input"
                  type="number"
                  value={g.carbsGoalG}
                  onChange={(e) => setGoal("carbsGoalG", Number(e.target.value))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Fat (g)
                <input
                  className="input"
                  type="number"
                  value={g.fatGoalG}
                  onChange={(e) => setGoal("fatGoalG", Number(e.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Sleep target (hours)
                <input
                  className="input"
                  type="number"
                  step="0.5"
                  value={g.sleepTargetHours}
                  onChange={(e) => setGoal("sleepTargetHours", Number(e.target.value))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Goal weight (lb)
                <input
                  className="input"
                  type="number"
                  placeholder="—"
                  value={g.weightGoal ?? ""}
                  onChange={(e) => setGoal("weightGoal", num(e.target.value))}
                />
              </label>
            </div>
            <label className="field">
              Overall goal statement
              <textarea
                className="input"
                rows={2}
                placeholder="e.g. Cut to 180 lb by summer while keeping bench strength"
                value={g.goalStatement}
                onChange={(e) => setGoal("goalStatement", e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Daily score weights</h3>
        <p className="card-sub">
          These decide how much each tab counts toward your daily score. Pick a goal preset
          or set your own. Weights always add up to 100%.
        </p>
        <div className="stack">
          <label className="field">
            Goal preset
            <select
              className="input"
              value={goalPreset ?? "balanced"}
              onChange={(e) => applyPreset(e.target.value)}
            >
              {Object.entries(SCORE_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          {SEGMENT_KEYS.map((seg) => {
            const pct = Math.round(shares[seg] * 100);
            return (
              <div className="meter" key={seg}>
                <div className="meter-head">
                  <span className="name">{SEGMENT_LABELS[seg]}</span>
                  <span className="val">{pct}% of score</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    style={{ width: 88 }}
                    value={sw[seg] ?? 0}
                    onChange={(e) => {
                      // Clamp on entry: a typed/pasted negative is a valid number
                      // string the min= attribute doesn't block, and the validator
                      // rejects <0 with a 400. Match normalizeWeights' tolerance.
                      const n = Number(e.target.value);
                      setWeight(seg, Number.isFinite(n) ? Math.max(0, n) : 0);
                    }}
                  />
                  <div className="track" style={{ flex: 1 }}>
                    <div className="fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {usingDefaultWeights && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--status-warning)" }}>
            All five weights are 0, so the score falls back to the Balanced defaults shown above
            until you raise at least one segment above 0.
          </p>
        )}
        <p className="empty" style={{ margin: "10px 0 0", fontSize: 12 }}>
          Your daily score now starts at 0 each day and climbs as you log progress in each tab.
        </p>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save}>
          Save settings
        </button>
        {saved && <span style={{ color: "var(--good-text)", fontSize: 13 }}>Saved ✓</span>}
        {error && <span className="error-text">{error}</span>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between">
          <h3>Current weight</h3>
          {latest ? (
            <span className="chip">
              latest: {latest.weight} lb ({latest.date})
            </span>
          ) : (
            <span className="chip">latest: —</span>
          )}
        </div>
        <p className="card-sub">
          Logs to today's weight history. Your latest weight drives your estimated daily burn at
          rest + activity, and your calorie balance.
        </p>
        <div className="row wrap">
          <input
            className="input"
            style={{ width: 120 }}
            type="number"
            step={0.1}
            min={1}
            placeholder="lb"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") logWeight();
            }}
          />
          <button className="btn primary" onClick={logWeight} disabled={weightBusy}>
            Log today's weight
          </button>
          {weightSaved && (
            <span style={{ color: "var(--good-text)", fontSize: 13 }}>Logged ✓</span>
          )}
          {weightError && <span className="error-text">{weightError}</span>}
        </div>
      </div>

      {LocalCards && (
        <Suspense fallback={null}>
          <LocalCards />
        </Suspense>
      )}
    </div>
  );
}
