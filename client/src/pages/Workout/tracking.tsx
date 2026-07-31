import type { ExerciseTrackingType, PlanDayExercise, SessionSet } from "@shared/types";
import { kmFromMi, miFromKm } from "../../units";

// ---------------------------------------------------------------------------
// Tracking-type helpers shared by the exercise library, the guided/live loggers
// and the Follow player. One exercise's `trackingType` drives which fields a set
// records — weight×reps, reps, a timed hold, a distance, or a plain count — so
// the loggers only ever show (and send) the inputs that make sense for it.
// ---------------------------------------------------------------------------

export const TRACKING_TYPES: { value: ExerciseTrackingType; label: string; hint: string }[] = [
  { value: "weight_reps", label: "Weight × reps", hint: "barbell / dumbbell lifts" },
  { value: "reps", label: "Reps only", hint: "push-ups, pull-ups, air squats" },
  { value: "time", label: "Timed hold", hint: "planks, wall sits, dead hangs" },
  { value: "distance", label: "Distance", hint: "rowing, ski-erg, loaded carries" },
  { value: "count", label: "Count", hint: "rounds, throws, jumps" },
];

const LABELS: Record<ExerciseTrackingType, string> = {
  weight_reps: "Weight × reps",
  reps: "Reps only",
  time: "Timed hold",
  distance: "Distance",
  count: "Count",
};

export function trackingLabel(t: ExerciseTrackingType): string {
  return LABELS[t] ?? t;
}

// meters <-> miles (1 mi = 1609.344 m exactly, via the units contract) --------
export function metersFromMiles(mi: number): number {
  return kmFromMi(mi) * 1000;
}
export function milesFromMeters(m: number): number {
  return miFromKm(m / 1000);
}

/** "2026-07-30" -> "Jul 30" — the app's compact table/chip date (matches the
 *  Cardio recent-log table); keep the full ISO date in a title tooltip. */
export function fmtShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Seconds → compact "m:ss" (or "45s" under a minute). */
export function fmtSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

// ---------------------------------------------------------------------------
// Draft state + validation
// ---------------------------------------------------------------------------

/** Raw string inputs for one performed set/entry; only the fields the exercise's
 *  tracking type uses are ever read. */
export interface TrackDraft {
  sets: string;
  reps: string;
  weight: string;
  rpe: string;
  timeMin: string;
  distanceMi: string;
  count: string;
}

export function emptyDraft(sets = "1"): TrackDraft {
  return { sets, reps: "", weight: "", rpe: "", timeMin: "", distanceMi: "", count: "" };
}

/** The measured payload for one set (matches the api set/entry shape). */
export interface Measure {
  reps: number;
  weight?: number | null;
  rpe?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  count?: number | null;
}

/** Has the user entered the value this tracking type needs? */
export function draftHasValue(type: ExerciseTrackingType, d: TrackDraft): boolean {
  switch (type) {
    case "weight_reps":
    case "reps":
      return d.reps.trim() !== "";
    case "time":
      return d.timeMin.trim() !== "";
    case "distance":
      return d.distanceMi.trim() !== "";
    case "count":
      return d.count.trim() !== "";
  }
}

/**
 * Did the user put ANYTHING measurable into this row (a measured field or the
 * intensity/RPE)? `sets` is prefilled from the template so it doesn't count.
 * Distinguishes an intentionally-skipped blank row (skip it) from a half-filled
 * one — e.g. a weight typed with no reps — which must be surfaced, not dropped.
 */
export function draftTouched(type: ExerciseTrackingType, d: TrackDraft): boolean {
  if (d.rpe.trim() !== "") return true;
  switch (type) {
    case "weight_reps":
      return d.reps.trim() !== "" || d.weight.trim() !== "";
    case "reps":
      return d.reps.trim() !== "";
    case "time":
      return d.timeMin.trim() !== "";
    case "distance":
      return d.distanceMi.trim() !== "";
    case "count":
      return d.count.trim() !== "";
  }
}

export function parseSets(
  raw: string,
  label: string,
): { ok: true; sets: number } | { ok: false; error: string } {
  const v = raw.trim() === "" ? 1 : Number(raw);
  if (!Number.isInteger(v) || v < 1 || v > 20) {
    return { ok: false, error: `${label}: sets must be a whole number 1-20` };
  }
  return { ok: true, sets: v };
}

/** Validate a draft for its tracking type and produce the measured payload. */
export function buildMeasure(
  type: ExerciseTrackingType,
  d: TrackDraft,
  label: string,
): { ok: true; measure: Measure } | { ok: false; error: string } {
  const rpe = d.rpe.trim() === "" ? null : Number(d.rpe);
  if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
    return { ok: false, error: `${label}: intensity must be a whole number 1-10` };
  }

  if (type === "weight_reps" || type === "reps") {
    const reps = Number(d.reps);
    if (!Number.isInteger(reps) || reps <= 0 || reps > 1000) {
      return { ok: false, error: `${label}: reps must be a whole number 1-1000` };
    }
    let weight: number | null = null;
    if (type === "weight_reps" && d.weight.trim() !== "") {
      weight = Number(d.weight);
      if (!Number.isFinite(weight) || weight < 0) {
        return { ok: false, error: `${label}: weight must be 0 lb or more` };
      }
    }
    return { ok: true, measure: { reps, weight, rpe } };
  }

  if (type === "time") {
    const min = Number(d.timeMin);
    if (!Number.isFinite(min) || min <= 0) {
      return { ok: false, error: `${label}: time must be more than 0 minutes` };
    }
    const durationSeconds = Math.round(min * 60);
    if (durationSeconds < 1 || durationSeconds > 21600) {
      return { ok: false, error: `${label}: time must be between 0.02 and 360 minutes` };
    }
    return { ok: true, measure: { reps: 0, durationSeconds, rpe } };
  }

  if (type === "distance") {
    const mi = Number(d.distanceMi);
    if (!Number.isFinite(mi) || mi <= 0) {
      return { ok: false, error: `${label}: distance must be more than 0 miles` };
    }
    return { ok: true, measure: { reps: 0, distanceM: metersFromMiles(mi), rpe } };
  }

  // count
  const c = Number(d.count);
  if (!Number.isInteger(c) || c <= 0 || c > 100000) {
    return { ok: false, error: `${label}: count must be a whole number, 1 or more` };
  }
  return { ok: true, measure: { reps: 0, count: c, rpe } };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Describe a logged set for its tracking type, e.g. "185×5", "×12", "1:00", "1.20 mi". */
export function describeSet(st: SessionSet, type: ExerciseTrackingType): string {
  switch (type) {
    case "weight_reps":
      return `${st.weight ?? "BW"}×${st.reps}`;
    case "reps":
      return `×${st.reps}`;
    case "time":
      return st.durationSeconds != null ? fmtSeconds(st.durationSeconds) : "—";
    case "distance":
      return st.distanceM != null ? `${milesFromMeters(st.distanceM).toFixed(2)} mi` : "—";
    case "count":
      return st.count != null ? `×${st.count}` : "—";
  }
}

/** Describe an in-memory Measure (a set the user just logged, pre-save). */
export function describeMeasure(type: ExerciseTrackingType, m: Measure): string {
  switch (type) {
    case "weight_reps":
      return `${m.weight ?? "BW"}×${m.reps}`;
    case "reps":
      return `×${m.reps}`;
    case "time":
      return fmtSeconds(m.durationSeconds ?? 0);
    case "distance":
      return `${milesFromMeters(m.distanceM ?? 0).toFixed(2)} mi`;
    case "count":
      return `×${m.count ?? 0}`;
  }
}

/** Describe a logged set from whichever measure it carries (type-agnostic; also
 *  handles legacy weight/reps rows). Used where the exercise type isn't at hand. */
export function describeSetAuto(st: SessionSet): string {
  if (st.durationSeconds != null) return fmtSeconds(st.durationSeconds);
  if (st.distanceM != null) return `${milesFromMeters(st.distanceM).toFixed(2)} mi`;
  if (st.count != null) return `×${st.count}`;
  if (st.weight != null) return `${st.weight}×${st.reps}`;
  return `${st.reps} rep${st.reps === 1 ? "" : "s"}`;
}

/** Describe a plan-day prescription/target for its tracking type. */
export function describeTarget(pe: PlanDayExercise, type: ExerciseTrackingType): string {
  switch (type) {
    case "weight_reps":
      return `${pe.sets}×${pe.reps}${pe.targetWeight != null ? ` @ ${pe.targetWeight} lb` : ""}`;
    case "reps":
      return `${pe.sets}×${pe.reps}`;
    case "time":
      return `${pe.sets} × ${pe.targetSeconds != null ? fmtSeconds(pe.targetSeconds) : "hold"}`;
    case "distance":
      return pe.targetDistanceM != null
        ? `${pe.sets > 1 ? `${pe.sets} × ` : ""}${milesFromMeters(pe.targetDistanceM).toFixed(2)} mi`
        : `${pe.sets} set${pe.sets === 1 ? "" : "s"}`;
    case "count":
      return `${pe.sets} × ${pe.targetCount != null ? pe.targetCount : "count"}`;
  }
}

/** Prefill placeholders for a draft from a plan-day template + tracking type. */
export function templatePlaceholders(
  pe: PlanDayExercise,
  type: ExerciseTrackingType,
): Partial<Record<FieldKey, string>> {
  switch (type) {
    case "weight_reps":
      return {
        reps: pe.reps || "reps",
        weight: pe.targetWeight != null ? String(pe.targetWeight) : "lb",
      };
    case "reps":
      return { reps: pe.reps || "reps" };
    case "time":
      return { timeMin: pe.targetSeconds != null ? String(pe.targetSeconds / 60) : "min" };
    case "distance":
      return {
        distanceMi:
          pe.targetDistanceM != null ? milesFromMeters(pe.targetDistanceM).toFixed(2) : "mi",
      };
    case "count":
      return { count: pe.targetCount != null ? String(pe.targetCount) : "count" };
  }
}

// ---------------------------------------------------------------------------
// <TrackingInputs> — renders only the fields a tracking type needs
// ---------------------------------------------------------------------------

export type FieldKey = "sets" | "reps" | "weight" | "timeMin" | "distanceMi" | "count" | "rpe";

const MEASURE_FIELDS: Record<ExerciseTrackingType, FieldKey[]> = {
  weight_reps: ["reps", "weight"],
  reps: ["reps"],
  time: ["timeMin"],
  distance: ["distanceMi"],
  count: ["count"],
};

const FIELD_META: Record<
  FieldKey,
  { label: string; ph: string; width: number; step?: number; min?: number; select?: boolean }
> = {
  sets: { label: "Sets", ph: "sets", width: 60, min: 1 },
  reps: { label: "Reps", ph: "reps", width: 72, min: 0 },
  weight: { label: "Weight (lb)", ph: "lb", width: 84, min: 0, step: 0.5 },
  timeMin: { label: "Minutes", ph: "min", width: 78, min: 0, step: 0.5 },
  distanceMi: { label: "Distance (mi)", ph: "mi", width: 92, min: 0, step: 0.1 },
  count: { label: "Count", ph: "count", width: 80, min: 0 },
  rpe: { label: "Effort (1-10)", ph: "RPE", width: 132, select: true },
};

/**
 * Renders the inputs a tracking type needs, bound to a TrackDraft.
 * `stacked` = big labelled fields (Follow player); default = compact inline row.
 */
export function TrackingInputs(props: {
  type: ExerciseTrackingType;
  draft: TrackDraft;
  onChange: (patch: Partial<TrackDraft>) => void;
  placeholders?: Partial<Record<FieldKey, string>>;
  showSets?: boolean;
  showRpe?: boolean;
  stacked?: boolean;
  disabled?: boolean;
}) {
  const { type, draft, onChange, placeholders, showSets, showRpe, stacked, disabled } = props;
  const keys: FieldKey[] = [];
  if (showSets) keys.push("sets");
  keys.push(...MEASURE_FIELDS[type]);
  if (showRpe) keys.push("rpe");

  function field(k: FieldKey) {
    const meta = FIELD_META[k];
    const ph = placeholders?.[k] ?? meta.ph;
    const value = draft[k];
    const control = meta.select ? (
      <select
        className="input"
        style={stacked ? undefined : { width: meta.width }}
        title={meta.label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange({ [k]: e.target.value } as Partial<TrackDraft>)}
      >
        <option value="">Effort 1-10</option>
        {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    ) : (
      <input
        className="input"
        style={stacked ? undefined : { width: meta.width }}
        type="number"
        inputMode="decimal"
        min={meta.min}
        step={meta.step}
        title={meta.label}
        placeholder={ph}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange({ [k]: e.target.value } as Partial<TrackDraft>)}
      />
    );
    if (stacked) {
      return (
        <label key={k} className="field" style={{ flex: 1, minWidth: 120 }}>
          {meta.label}
          {control}
        </label>
      );
    }
    return <span key={k}>{control}</span>;
  }

  return (
    <div className={stacked ? "row wrap" : "row wrap"} style={{ gap: stacked ? 10 : 6 }}>
      {keys.map(field)}
    </div>
  );
}
