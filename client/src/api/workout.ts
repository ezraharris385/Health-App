import { http } from "./http";
import type {
  CardioSession,
  CardioType,
  Exercise,
  PlanDay,
  PlanDayExercise,
  SessionSet,
  WorkoutPlan,
  WorkoutSession,
} from "@shared/types";

// ---------------------------------------------------------------------------
// Composite shapes returned by /api/workout (mirror server/routes/workout.ts)
// ---------------------------------------------------------------------------

export interface PlanDayFull extends PlanDay {
  exercises: PlanDayExercise[];
}
export interface PlanFull extends WorkoutPlan {
  days: PlanDayFull[];
}
export interface SessionFull extends WorkoutSession {
  sets: SessionSet[];
}
export interface WeekDaySchedule {
  date: string;
  dayOfWeek: number;
  isToday: boolean;
  scheduled: {
    planDayId: number;
    planId: number;
    planName: string;
    dayName: string;
    exerciseCount: number;
  }[];
  sessions: { id: number; name: string; completedAt: string | null; setCount: number }[];
  cardio: CardioSession[];
}
export interface WeekSchedule {
  start: string;
  end: string;
  days: WeekDaySchedule[];
}
export interface PerformancePoint {
  date: string;
  sets: number;
  volume: number;
  bestWeight: number | null;
  bestReps: number;
  bestSet: string;
  est1RM: number | null;
}
export interface ExercisePerformance {
  exerciseId: number;
  exerciseName: string;
  points: PerformancePoint[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ExerciseInput {
  name: string;
  muscleGroups?: string;
  equipment?: string;
  instructions?: string;
  notes?: string;
}

export interface PlanInput {
  name: string;
  description?: string;
  goal?: string;
}

export interface PlanDayInput {
  name?: string;
  dayOfWeek?: number | null;
}

export interface PlanDayExerciseInput {
  exerciseId: number;
  sets?: number;
  reps?: string;
  targetWeight?: number | null;
  restSeconds?: number | null;
  notes?: string;
}

export interface SetInput {
  exerciseId: number;
  reps: number;
  weight?: number | null;
  rpe?: number | null;
  notes?: string;
}

export interface CardioInput {
  date?: string;
  type: CardioType;
  distanceKm: number;
  durationMinutes: number;
  intensity?: number;
  /** manual total-step override; omit/null to auto-estimate */
  steps?: number | null;
  report?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const base = "/api/workout";

export const workoutApi = {
  // exercises
  exercises: (query?: string) =>
    http.get<Exercise[]>(`${base}/exercises${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  createExercise: (input: ExerciseInput) => http.post<Exercise>(`${base}/exercises`, input),
  updateExercise: (id: number, patch: Partial<ExerciseInput>) =>
    http.put<Exercise>(`${base}/exercises/${id}`, patch),
  deleteExercise: (id: number) => http.del<{ ok: boolean }>(`${base}/exercises/${id}`),

  // plans
  plans: (includeArchived = false) =>
    http.get<PlanFull[]>(`${base}/plans${includeArchived ? "?includeArchived=1" : ""}`),
  createPlan: (input: PlanInput) => http.post<PlanFull>(`${base}/plans`, input),
  updatePlan: (id: number, patch: Partial<PlanInput> & { archived?: boolean }) =>
    http.put<PlanFull>(`${base}/plans/${id}`, patch),
  deletePlan: (id: number) => http.del<{ ok: boolean }>(`${base}/plans/${id}`),
  addPlanDay: (planId: number, input: PlanDayInput) =>
    http.post<PlanDayFull>(`${base}/plans/${planId}/days`, input),
  updatePlanDay: (
    dayId: number,
    patch: PlanDayInput & { exerciseOrder?: number[] },
  ) => http.put<PlanDayFull>(`${base}/plan-days/${dayId}`, patch),
  deletePlanDay: (dayId: number) => http.del<{ ok: boolean }>(`${base}/plan-days/${dayId}`),
  addPlanDayExercise: (dayId: number, input: PlanDayExerciseInput) =>
    http.post<PlanDayExercise>(`${base}/plan-days/${dayId}/exercises`, input),
  updatePlanDayExercise: (id: number, patch: Partial<PlanDayExerciseInput>) =>
    http.put<PlanDayExercise>(`${base}/plan-exercises/${id}`, patch),
  deletePlanDayExercise: (id: number) => http.del<{ ok: boolean }>(`${base}/plan-exercises/${id}`),

  // schedule
  week: (date?: string) => http.get<WeekSchedule>(`${base}/week${date ? `?date=${date}` : ""}`),

  // sessions & sets
  sessions: (opts: { days?: number; date?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.days !== undefined) params.set("days", String(opts.days));
    if (opts.date) params.set("date", opts.date);
    const qs = params.toString();
    return http.get<SessionFull[]>(`${base}/sessions${qs ? `?${qs}` : ""}`);
  },
  session: (id: number) => http.get<SessionFull>(`${base}/sessions/${id}`),
  createSession: (input: { date?: string; planDayId?: number; name?: string; notes?: string }) =>
    http.post<SessionFull>(`${base}/sessions`, input),
  updateSession: (id: number, patch: { name?: string; notes?: string; date?: string }) =>
    http.put<SessionFull>(`${base}/sessions/${id}`, patch),
  completeSession: (id: number) => http.post<SessionFull>(`${base}/sessions/${id}/complete`),
  deleteSession: (id: number) => http.del<{ ok: boolean }>(`${base}/sessions/${id}`),
  addSet: (sessionId: number, input: SetInput) =>
    http.post<SessionSet>(`${base}/sessions/${sessionId}/sets`, input),
  updateSet: (id: number, patch: Partial<SetInput>) =>
    http.put<SessionSet>(`${base}/sets/${id}`, patch),
  deleteSet: (id: number) => http.del<{ ok: boolean }>(`${base}/sets/${id}`),

  // performance
  performance: (exerciseId: number, days = 180) =>
    http.get<ExercisePerformance>(`${base}/performance/${exerciseId}?days=${days}`),

  // cardio
  cardio: (days = 90) => http.get<CardioSession[]>(`${base}/cardio?days=${days}`),
  createCardio: (input: CardioInput) => http.post<CardioSession>(`${base}/cardio`, input),
  updateCardio: (id: number, patch: Partial<CardioInput>) =>
    http.put<CardioSession>(`${base}/cardio/${id}`, patch),
  deleteCardio: (id: number) => http.del<{ ok: boolean }>(`${base}/cardio/${id}`),
};

/** Effective steps for a cardio row: manual override if present, else estimates. */
export function cardioTotalSteps(c: CardioSession): number {
  return c.steps ?? (c.estimatedStepsRun ?? 0) + (c.estimatedStepsWalked ?? 0);
}

export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
