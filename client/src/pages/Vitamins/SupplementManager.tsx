/**
 * Supplement library manager: table of all supplements (active + inactive)
 * with edit / activate-deactivate / delete, and a create-or-edit form with one
 * per-dose amount row per tracked nutrient (shared/nutrients).
 */
import { useState } from "react";
import type { MicroMap, Supplement } from "@shared/types";
import { NUTRIENTS, NUTRIENT_BY_KEY } from "@shared/nutrients";
import { vitaminsApi } from "../../api/vitamins";

type MacroField = "calories" | "proteinG" | "carbsG" | "fatG" | "sugarG" | "sodiumMg";

/** Per-dose macro fields shown in the create/edit form and the list summary. */
const MACRO_FIELDS: { key: MacroField; label: string; unit: string; short: string }[] = [
  { key: "calories", label: "Calories", unit: "kcal", short: "kcal" },
  { key: "proteinG", label: "Protein", unit: "g", short: "g protein" },
  { key: "carbsG", label: "Carbs", unit: "g", short: "g carbs" },
  { key: "fatG", label: "Fat", unit: "g", short: "g fat" },
  { key: "sugarG", label: "Sugar", unit: "g", short: "g sugar" },
  { key: "sodiumMg", label: "Sodium", unit: "mg", short: "mg sodium" },
];

interface FormState {
  id: number | null; // null = creating
  name: string;
  notes: string;
  /** raw input strings keyed by nutrient key */
  nutrients: Record<string, string>;
  /** raw input strings keyed by macro field */
  macros: Record<string, string>;
}

const fmtAmt = (n: number) =>
  Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);

export function contentsSummary(nutrients: MicroMap, max = 4): string {
  const parts = Object.entries(nutrients)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k, v]) => {
      const def = NUTRIENT_BY_KEY[k];
      return def ? `${def.label} ${fmtAmt(v as number)} ${def.unit}` : `${k} ${v}`;
    });
  if (parts.length === 0) return "no nutrients set";
  return parts.slice(0, max).join(", ") + (parts.length > max ? ` +${parts.length - max} more` : "");
}

/** Compact per-dose macro line ("50 kcal · 5 g protein…"); "" when all zero. */
export function macrosSummary(s: Supplement): string {
  return MACRO_FIELDS.filter((f) => (s[f.key] ?? 0) > 0)
    .map((f) => `${fmtAmt(s[f.key])} ${f.short}`)
    .join(" · ");
}

function emptyForm(): FormState {
  return { id: null, name: "", notes: "", nutrients: {}, macros: {} };
}

function formFromSupplement(s: Supplement): FormState {
  const nutrients: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.nutrients)) {
    if (typeof v === "number" && v > 0) nutrients[k] = String(v);
  }
  const macros: Record<string, string> = {};
  for (const f of MACRO_FIELDS) {
    if ((s[f.key] ?? 0) > 0) macros[f.key] = String(s[f.key]);
  }
  return { id: s.id, name: s.name, notes: s.notes, nutrients, macros };
}

export function SupplementManager(props: {
  supplements: Supplement[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      props.onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    const nutrients: MicroMap = {};
    for (const [key, raw] of Object.entries(form.nutrients)) {
      if (raw === undefined || raw.trim() === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`${NUTRIENT_BY_KEY[key]?.label ?? key}: amount must be a non-negative number`);
        return;
      }
      if (n > 0) nutrients[key] = n;
    }
    // Always send explicit macro values (blank → 0) so the form is WYSIWYG:
    // clearing a field on edit resets that macro to zero.
    const macros: Record<MacroField, number> = {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      sugarG: 0,
      sodiumMg: 0,
    };
    for (const f of MACRO_FIELDS) {
      const raw = (form.macros[f.key] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`${f.label}: must be a non-negative number`);
        return;
      }
      macros[f.key] = n;
    }
    const ok = await run(() =>
      form.id === null
        ? vitaminsApi.createSupplement({ name, nutrients, notes: form.notes, ...macros })
        : vitaminsApi.updateSupplement(form.id, { name, nutrients, notes: form.notes, ...macros }),
    );
    if (ok) setForm(null);
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Supplement library</h3>
        {!form && (
          <button className="btn small primary" onClick={() => setForm(emptyForm())}>
            New supplement
          </button>
        )}
      </div>

      {props.supplements.length === 0 && !form && (
        <p className="empty">
          No supplements yet. Add your multivitamin, vitamin D, fish oil… — each with its per-dose
          nutrient contents so coverage counts them when you mark them taken.
        </p>
      )}

      {props.supplements.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Per-dose contents</th>
              <th>Status</th>
              <th style={{ width: 220 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.supplements.map((s) => (
              <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  {s.notes && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.notes}</div>
                  )}
                </td>
                <td style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  <div>{contentsSummary(s.nutrients)}</div>
                  {macrosSummary(s) && (
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>{macrosSummary(s)}</div>
                  )}
                </td>
                <td>
                  <span className="chip">{s.active ? "active" : "inactive"}</span>
                </td>
                <td>
                  <div className="row">
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setForm(formFromSupplement(s));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        run(() => vitaminsApi.updateSupplement(s.id, { active: s.active ? 0 : 1 }))
                      }
                    >
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${s.name}"? Its taken-history will be removed too. Deactivating keeps history.`,
                          )
                        ) {
                          run(() => vitaminsApi.deleteSupplement(s.id));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="row between">
            <strong>{form.id === null ? "New supplement" : `Edit: ${form.name || "supplement"}`}</strong>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 2 }}>
              Name
              <input
                className="input"
                value={form.name}
                placeholder="e.g. Daily Multivitamin"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 3 }}>
              Notes (brand, dosing…)
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500, marginBottom: 2 }}>
              Per-dose macros (leave blank for none)
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              Counts toward your Nutrition calories/macros on days you take it.
            </div>
            <div className="grid cols-4">
              {MACRO_FIELDS.map((f) => (
                <label key={f.key} className="field">
                  {f.label} ({f.unit})
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="any"
                    placeholder="0"
                    value={form.macros[f.key] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        macros: { ...form.macros, [f.key]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500, marginBottom: 6 }}>
              Nutrient contents per dose (leave blank for none)
            </div>
            <div className="grid cols-4">
              {NUTRIENTS.map((n) => (
                <label key={n.key} className="field">
                  {n.label} ({n.unit})
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="any"
                    placeholder="0"
                    value={form.nutrients[n.key] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        nutrients: { ...form.nutrients, [n.key]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>
              {form.id === null ? "Create supplement" : "Save changes"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
