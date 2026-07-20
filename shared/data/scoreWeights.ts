/**
 * Daily-score segment weights. The five scored segments each contribute to the
 * total daily score in proportion to a user-customizable weight. Weights are
 * stored as raw points in the settings JSON blob (settings.scoreWeights) and
 * normalized to fractions summing to 1 at scoring time.
 *
 * Goal-based presets (SCORE_PRESETS) give one-tap starting points; the user can
 * then tweak any segment, which flips settings.scoreGoalPreset to 'custom'.
 *
 * This module is pure and runtime-agnostic — no DB, no side effects.
 */

export type ScoreSegment = "workout" | "nutrition" | "sleep" | "vitamins" | "mobility";

export const SEGMENT_KEYS: ScoreSegment[] = [
  "workout",
  "nutrition",
  "sleep",
  "vitamins",
  "mobility",
];

/** Raw points for the "balanced" preset — also the app default. Sums to 100. */
export const DEFAULT_SCORE_WEIGHTS: Record<ScoreSegment, number> = {
  workout: 22,
  nutrition: 28,
  sleep: 22,
  vitamins: 15,
  mobility: 13,
};

export interface ScorePreset {
  label: string;
  weights: Record<ScoreSegment, number>;
}

/** Goal-based weight presets. Every preset's raw points sum to 100. */
export const SCORE_PRESETS: Record<string, ScorePreset> = {
  balanced: { label: "Balanced", weights: { ...DEFAULT_SCORE_WEIGHTS } },
  fat_loss: {
    label: "Fat loss",
    weights: { workout: 24, nutrition: 34, sleep: 20, vitamins: 12, mobility: 10 },
  },
  muscle_gain: {
    label: "Muscle gain",
    weights: { workout: 30, nutrition: 30, sleep: 22, vitamins: 10, mobility: 8 },
  },
  mental_performance: {
    label: "Mental performance",
    weights: { workout: 14, nutrition: 24, sleep: 30, vitamins: 22, mobility: 10 },
  },
  recovery: {
    label: "Recovery & mobility",
    weights: { workout: 16, nutrition: 20, sleep: 28, vitamins: 12, mobility: 24 },
  },
  general_health: {
    label: "General health",
    weights: { workout: 20, nutrition: 26, sleep: 24, vitamins: 16, mobility: 14 },
  },
};

/** Divide a fully-populated raw-weight map by its (already-positive) total. */
function toFractions(raw: Record<ScoreSegment, number>): Record<ScoreSegment, number> {
  const total = SEGMENT_KEYS.reduce((sum, k) => sum + raw[k], 0);
  const out = {} as Record<ScoreSegment, number>;
  for (const k of SEGMENT_KEYS) out[k] = raw[k] / total;
  return out;
}

/**
 * Normalize raw segment weights into fractions per segment summing to 1.
 * - Missing/partial input: missing segments are filled from DEFAULT_SCORE_WEIGHTS.
 * - Any provided value non-finite or negative, or a resulting total <= 0
 *   (e.g. all zeros): falls back entirely to the default weights.
 * Pure and safe — never throws.
 */
export function normalizeWeights(
  raw: Partial<Record<ScoreSegment, number>> | null | undefined,
): Record<ScoreSegment, number> {
  const merged: Record<ScoreSegment, number> = { ...DEFAULT_SCORE_WEIGHTS };
  let valid = true;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of SEGMENT_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue; // missing → keep default
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        valid = false;
        break;
      }
      merged[key] = v;
    }
  }
  const total = SEGMENT_KEYS.reduce((sum, k) => sum + merged[k], 0);
  if (!valid || total <= 0) return toFractions(DEFAULT_SCORE_WEIGHTS);
  return toFractions(merged);
}

/** Normalized segment fractions for a settings object. */
export function effectiveWeights(settings: {
  scoreWeights?: Partial<Record<ScoreSegment, number>>;
}): Record<ScoreSegment, number> {
  return normalizeWeights(settings.scoreWeights ?? DEFAULT_SCORE_WEIGHTS);
}
