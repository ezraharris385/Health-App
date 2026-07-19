import { useEffect, useState } from "react";
import { settingsApi } from "../../api/settings";
import type { Settings } from "@shared/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.get().then(setSettings).catch((e) => setError(e.message));
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

  async function save() {
    // Guard against empty/cleared numeric fields: Number("") === 0 and a zero
    // goal breaks every score computation downstream.
    const required: [string, number][] = [
      ["Calories", g.calorieGoal],
      ["Protein", g.proteinGoalG],
      ["Carbs", g.carbsGoalG],
      ["Fat", g.fatGoalG],
      ["Water", g.waterGoalMl],
      ["Sleep target", g.sleepTargetHours],
    ];
    for (const [label, value] of required) {
      if (!Number.isFinite(value) || value <= 0) {
        setError(`${label} must be a positive number.`);
        return;
      }
    }
    setError(null);
    try {
      const next = await settingsApi.save(settings!);
      setSettings(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Profile and daily goals — the agents and scores use these.</p>

      <div className="grid cols-2">
        <div className="card">
          <h3>Profile</h3>
          <div className="stack">
            <label className="field">
              Name
              <input className="input" value={p.name} onChange={(e) => setProfile("name", e.target.value)} />
            </label>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Age
                <input className="input" type="number" value={p.age ?? ""} onChange={(e) => setProfile("age", num(e.target.value))} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Height (cm)
                <input className="input" type="number" value={p.heightCm ?? ""} onChange={(e) => setProfile("heightCm", num(e.target.value))} />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Sex
                <select className="input" value={p.sex ?? ""} onChange={(e) => setProfile("sex", e.target.value || null)}>
                  <option value="">—</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                Activity level
                <select className="input" value={p.activityLevel ?? ""} onChange={(e) => setProfile("activityLevel", e.target.value || null)}>
                  <option value="">—</option>
                  <option value="sedentary">Sedentary</option>
                  <option value="light">Light</option>
                  <option value="moderate">Moderate</option>
                  <option value="active">Active</option>
                  <option value="very_active">Very active</option>
                </select>
              </label>
            </div>
            <label className="field">
              Notes for the agents (injuries, preferences, context)
              <textarea className="input" rows={3} value={p.notes} onChange={(e) => setProfile("notes", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card">
          <h3>Daily goals</h3>
          <div className="stack">
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Calories (kcal)
                <input className="input" type="number" value={g.calorieGoal} onChange={(e) => setGoal("calorieGoal", Number(e.target.value))} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Water (ml)
                <input className="input" type="number" value={g.waterGoalMl} onChange={(e) => setGoal("waterGoalMl", Number(e.target.value))} />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Protein (g)
                <input className="input" type="number" value={g.proteinGoalG} onChange={(e) => setGoal("proteinGoalG", Number(e.target.value))} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Carbs (g)
                <input className="input" type="number" value={g.carbsGoalG} onChange={(e) => setGoal("carbsGoalG", Number(e.target.value))} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Fat (g)
                <input className="input" type="number" value={g.fatGoalG} onChange={(e) => setGoal("fatGoalG", Number(e.target.value))} />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Sleep target (hours)
                <input className="input" type="number" step="0.5" value={g.sleepTargetHours} onChange={(e) => setGoal("sleepTargetHours", Number(e.target.value))} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Weight goal ({g.weightUnit})
                <input className="input" type="number" value={g.weightGoal ?? ""} onChange={(e) => setGoal("weightGoal", num(e.target.value))} />
              </label>
              <label className="field" style={{ width: 90 }}>
                Unit
                <select className="input" value={g.weightUnit} onChange={(e) => setGoal("weightUnit", e.target.value)}>
                  <option value="lb">lb</option>
                  <option value="kg">kg</option>
                </select>
              </label>
            </div>
            <label className="field">
              Overall goal statement
              <textarea
                className="input"
                rows={2}
                placeholder="e.g. Cut to 180lb by summer while keeping bench strength"
                value={g.goalStatement}
                onChange={(e) => setGoal("goalStatement", e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save}>
          Save settings
        </button>
        {saved && <span style={{ color: "var(--good-text)", fontSize: 13 }}>Saved ✓</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  );
}
