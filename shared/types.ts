/**
 * Shared types between server and client.
 * Dates are local calendar dates as "YYYY-MM-DD" strings unless noted.
 * Timestamps are ISO 8601 strings.
 */

// ---------------------------------------------------------------------------
// Settings / goals
// ---------------------------------------------------------------------------

export interface UserGoals {
  calorieGoal: number; // kcal/day
  proteinGoalG: number;
  carbsGoalG: number;
  fatGoalG: number;
  waterGoalMl: number;
  sleepTargetHours: number;
  weightGoal: number | null; // in weightUnit
  weightUnit: "lb" | "kg";
  /** Free-text overall goal, e.g. "cut to 180lb while keeping strength" */
  goalStatement: string;
}

export interface UserProfile {
  name: string;
  age: number | null;
  heightCm: number | null;
  sex: "male" | "female" | "other" | null;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "very_active" | null;
  notes: string;
}

export interface Settings {
  profile: UserProfile;
  goals: UserGoals;
  /** Per-nutrient daily target overrides, keyed by NutrientKey */
  nutrientTargetOverrides: Partial<Record<string, number>>;
  /**
   * Raw daily-score segment weights (points). Normalized to fractions at
   * scoring time by shared/data/scoreWeights.ts.
   */
  scoreWeights: Record<"workout" | "nutrition" | "sleep" | "vitamins" | "mobility", number>;
  /** Selected goal preset key (a SCORE_PRESETS key) or 'custom'. */
  scoreGoalPreset?: string;
}

// ---------------------------------------------------------------------------
// Energy (calorie burn / caloric balance)
// ---------------------------------------------------------------------------

/**
 * A day's caloric balance. Burn splits into a baseline (TDEE from the body
 * profile) and logged exercise (cardio + strength estimates). `net` is
 * intake − total burn (positive = surplus); it and `status` are null until the
 * profile has enough data (age, height, and a known body weight).
 */
export interface EnergyBalance {
  date: string;
  /** true only when age, heightCm, and a known body weight are all present */
  hasProfile: boolean;
  weightLb: number | null;
  bmr: number | null;
  tdee: number | null;
  activityLevel: UserProfile["activityLevel"];
  intakeCalories: number;
  /** baseline (resting + activity) burn = TDEE, or null without a profile */
  baselineBurn: number | null;
  exerciseBurn: number;
  totalBurn: number;
  /** intake − totalBurn; null when !hasProfile */
  net: number | null;
  status: "deficit" | "surplus" | "even" | null;
}

// ---------------------------------------------------------------------------
// Workout
// ---------------------------------------------------------------------------

/** How performed sets of an exercise are measured (drives the logger input mode). */
export type ExerciseTrackingType = "weight_reps" | "reps" | "time" | "distance" | "count";

export interface Exercise {
  id: number;
  name: string;
  muscleGroups: string; // comma-separated, e.g. "chest, triceps"
  equipment: string;
  /** How the exercise is performed (form cues) */
  instructions: string;
  notes: string;
  /** What a set records: weight×reps, reps only, timed hold, distance, or a plain count */
  trackingType: ExerciseTrackingType;
  /** Recommended intensity guidance, e.g. "RPE 8, ~2 reps in reserve" */
  intensityRec: string;
  /** Recommended goal/target guidance, e.g. "3×8-12 for hypertrophy" */
  goalRec: string;
  createdAt: string;
}

export interface WorkoutPlan {
  id: number;
  name: string;
  description: string;
  goal: string; // e.g. "hypertrophy", "strength", free text
  archived: 0 | 1;
  createdAt: string;
}

/** A day within a plan; dayOfWeek 0=Sunday..6=Saturday, null = unscheduled template day */
export interface PlanDay {
  id: number;
  planId: number;
  dayOfWeek: number | null;
  name: string; // e.g. "Push A"
  orderIndex: number;
}

export interface PlanDayExercise {
  id: number;
  planDayId: number;
  exerciseId: number;
  orderIndex: number;
  sets: number;
  reps: string; // e.g. "8-12"
  targetWeight: number | null;
  restSeconds: number | null;
  targetSeconds: number | null; // target hold/work seconds for timed exercises
  targetDistanceM: number | null; // target distance in meters for distance exercises
  targetCount: number | null; // target count for count-tracked exercises
  notes: string;
  // joined convenience
  exerciseName?: string;
}

export interface WorkoutSession {
  id: number;
  date: string;
  planDayId: number | null;
  name: string;
  notes: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SessionSet {
  id: number;
  sessionId: number;
  exerciseId: number;
  setNumber: number;
  reps: number;
  weight: number | null;
  rpe: number | null; // 1-10 rate of perceived exertion
  durationSeconds: number | null; // seconds of timed work (e.g. planks)
  distanceM: number | null; // meters covered (distance-tracked work, e.g. rowing)
  count: number | null; // plain count (e.g. rounds, throws) for count-tracked work
  notes: string;
  exerciseName?: string;
}

export type CardioType =
  | "run"
  | "jog"
  | "walk"
  | "interval"
  | "hiit"
  | "cycling"
  | "rowing"
  | "elliptical"
  | "other";

export interface CardioSession {
  id: number;
  date: string;
  type: CardioType;
  /** Free-text label for the activity (esp. useful for type 'other') */
  activityLabel: string;
  distanceKm: number;
  durationMinutes: number;
  intensity: number; // 1-10
  /** Manually entered ("hardcoded") total steps; null = use estimates */
  steps: number | null;
  estimatedStepsRun: number | null;
  estimatedStepsWalked: number | null;
  /** User's report of how it went (used by the AI for analysis) */
  report: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

/** Micronutrients per serving, keyed by NutrientKey (see shared/nutrients) */
export type MicroMap = Partial<Record<string, number>>;

export interface Food {
  id: number;
  name: string;
  brand: string;
  servingSize: number;
  servingUnit: string; // g, ml, item, cup...
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
  /** micronutrients per serving; usually filled in by the AI agent */
  micros: MicroMap;
  source: "user" | "ai";
  createdAt: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodLog {
  id: number;
  date: string;
  foodId: number;
  servings: number;
  meal: MealType;
  loggedAt: string;
  // joined convenience
  food?: Food;
}

export interface WaterLog {
  id: number;
  date: string;
  amountMl: number;
  loggedAt: string;
}

export interface WeightLog {
  id: number;
  date: string;
  weight: number; // in the user's weightUnit
  loggedAt: string;
}

export interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
}

export interface DailyNutritionSummary {
  date: string;
  totals: MacroTotals;
  goals: UserGoals;
  byMeal: Record<MealType, MacroTotals>;
  waterMl: number;
  logs: FoodLog[];
}

// ---------------------------------------------------------------------------
// Mobility (stretching / yoga / posture)
// ---------------------------------------------------------------------------

export type StretchCategory = "stretch" | "yoga" | "posture";

/** Named illustrative animation for a stretch/pose (drives the on-page demo). */
export type MobilityAnimKind =
  | "none"
  | "reach_up"
  | "forward_fold"
  | "twist"
  | "lunge"
  | "hold"
  | "side_bend"
  | "cat_cow"
  | "neck_roll";

/** A stretch, yoga pose, or posture drill in the user's bank. */
export interface Stretch {
  id: number;
  name: string;
  category: StretchCategory;
  targetAreas: string; // comma-separated, e.g. "hamstrings, hips"
  /** How to perform it (form cues) */
  instructions: string;
  defaultHoldSeconds: number | null;
  /** What the pose is for, e.g. "loosen tight hamstrings before running" */
  goal: string;
  /** Primary focus area/theme, e.g. "posterior chain" */
  focus: string;
  /** Where you should feel it, e.g. "back of the thighs, behind the knees" */
  feelWhere: string;
  /** Illustrative animation to show alongside the pose */
  animKind: MobilityAnimKind;
  notes: string;
  createdAt: string;
}

export interface MobilityRoutine {
  id: number;
  name: string;
  description: string;
  focus: string; // e.g. "hip mobility", "desk posture reset"
  archived: 0 | 1;
  createdAt: string;
}

export interface MobilityRoutineItem {
  id: number;
  routineId: number;
  stretchId: number;
  orderIndex: number;
  holdSeconds: number | null;
  reps: number | null;
  perSide: 0 | 1;
  notes: string;
  stretchName?: string;
}

export type MobilityKind = "stretch" | "yoga" | "posture" | "mixed";

export interface MobilitySession {
  id: number;
  date: string;
  kind: MobilityKind;
  routineId: number | null;
  durationMinutes: number;
  /** 1-5 how it felt */
  feel: number | null;
  /** Free-text qualitative report the agent uses for analysis */
  report: string;
  notes: string;
  performedAt: string;
  routineName?: string;
}

/** A user-defined qualitative metric tracked over time (rated 1-10). */
export interface MobilityMetric {
  id: number;
  name: string; // e.g. "Hamstring flexibility", "Morning back stiffness"
  description: string;
  direction: "higher_better" | "lower_better";
  active: 0 | 1;
  createdAt: string;
}

export interface MobilityAssessment {
  id: number;
  date: string;
  metricId: number;
  score: number; // 1-10
  notes: string;
  loggedAt: string;
  metricName?: string;
}

export interface MobilityDaySummary {
  date: string;
  sessions: MobilitySession[];
  totalMinutes: number;
  byKind: Partial<Record<MobilityKind, number>>;
  assessmentsToday: MobilityAssessment[];
  /** Latest score per active metric (whenever it was last rated) */
  metricsLatest: {
    metricId: number;
    name: string;
    direction: "higher_better" | "lower_better";
    latestScore: number | null;
    latestDate: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

export interface SleepLog {
  id: number;
  /** date the sleep is attributed to (the wake date) */
  date: string;
  bedTime: string; // ISO timestamp
  wakeTime: string | null; // null = currently sleeping
  quality: number | null; // 1-5 optional
  notes: string;
  durationHours: number | null;
}

// ---------------------------------------------------------------------------
// Vitamins / micronutrients
// ---------------------------------------------------------------------------

export interface NutrientDef {
  key: string; // e.g. "vitamin_c_mg"
  label: string; // "Vitamin C"
  unit: string; // "mg"
  dailyTarget: number; // default adult daily target
  upperLimit: number | null;
  /** Display grouping, e.g. "Vitamins", "Minerals", "Brain & fatty acids". */
  group: string;
}

export interface Supplement {
  id: number;
  name: string;
  /** nutrient contents per dose, keyed by NutrientKey */
  nutrients: MicroMap;
  /** macro contribution per dose — flows into the calorie tracker when taken */
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sugarG: number;
  sodiumMg: number;
  notes: string;
  active: 0 | 1;
  createdAt: string;
}

export interface SupplementLog {
  id: number;
  date: string;
  supplementId: number;
  takenAt: string;
  supplementName?: string;
}

export interface NutrientCoverage {
  key: string;
  label: string;
  unit: string;
  group: string;
  target: number;
  consumed: number; // total from food micros + supplements
  fromFood: number;
  fromSupplements: number;
  /** 0-100, capped at 100 */
  percent: number;
}

export interface DailyVitaminSummary {
  date: string;
  coverage: NutrientCoverage[];
  supplementsTaken: SupplementLog[];
  activeSupplements: Supplement[];
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface DailyScore {
  date: string;
  total: number; // 0-100
  workout: number;
  nutrition: number;
  sleep: number;
  vitamins: number;
  mobility: number;
  /**
   * Normalized segment weights actually used for this total, as integer
   * percents (from normalizeWeights × 100 rounded); they sum to ~100.
   */
  weights: { workout: number; nutrition: number; sleep: number; vitamins: number; mobility: number };
  breakdown: Record<string, string>; // human-readable explanation per component
}

export interface ScoreHistory {
  daily: DailyScore[];
  weeklyAverage: number; // average of last 7 days
  monthlyAverage: number; // average of last 30 days
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentName = "workout" | "nutrition" | "sleep" | "vitamins" | "mobility" | "master";

export interface AgentConversation {
  id: number;
  agent: AgentName;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Simplified message for the client UI */
export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  /** Rendered text (tool use is summarized server-side into toolEvents) */
  text: string;
  /** Names of tools the assistant called while producing this reply */
  toolEvents: string[];
  createdAt: string;
}

export interface AgentMemoryNote {
  id: number;
  agent: AgentName;
  category: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRequest {
  conversationId?: number;
  message: string;
}

export interface ChatResponse {
  conversationId: number;
  reply: ChatMessage;
}
