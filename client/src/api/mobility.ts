import { http } from "./http";
import type {
  MobilityAssessment,
  MobilityDaySummary,
  MobilityKind,
  MobilityMetric,
  MobilityRoutine,
  MobilityRoutineItem,
  MobilitySession,
  Stretch,
  StretchCategory,
} from "@shared/types";

// ---------------------------------------------------------------------------
// Composite shapes returned by /api/mobility (mirror server/routes/mobility.ts)
// ---------------------------------------------------------------------------

export type RoutineWithItems = MobilityRoutine & { items: MobilityRoutineItem[] };

export interface MobilityHistoryPoint {
  date: string;
  sessions: number;
  totalMinutes: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface StretchInput {
  name: string;
  category?: StretchCategory;
  targetAreas?: string;
  instructions?: string;
  defaultHoldSeconds?: number | null;
  notes?: string;
}

export interface RoutineItemInput {
  stretchId: number;
  holdSeconds?: number | null;
  reps?: number | null;
  perSide?: boolean | 0 | 1;
  notes?: string;
}

export interface RoutineInput {
  name: string;
  description?: string;
  focus?: string;
  items?: RoutineItemInput[];
}

export interface SessionInput {
  date?: string;
  kind?: MobilityKind;
  routineId?: number | null;
  durationMinutes: number;
  feel?: number | null;
  report?: string;
  notes?: string;
}

export interface MetricInput {
  name: string;
  description?: string;
  direction?: MobilityMetric["direction"];
}

export interface AssessmentInput {
  metricId: number;
  score: number;
  date?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const base = "/api/mobility";

export const mobilityApi = {
  // summary & history
  summary: (date?: string) =>
    http.get<MobilityDaySummary>(
      `${base}/summary${date ? `?date=${encodeURIComponent(date)}` : ""}`,
    ),
  history: (days = 30) => http.get<MobilityHistoryPoint[]>(`${base}/history?days=${days}`),

  // stretch bank
  stretches: () => http.get<Stretch[]>(`${base}/stretches`),
  createStretch: (input: StretchInput) => http.post<Stretch>(`${base}/stretches`, input),
  updateStretch: (id: number, patch: Partial<StretchInput>) =>
    http.put<Stretch>(`${base}/stretches/${id}`, patch),
  deleteStretch: (id: number) => http.del<{ ok: boolean }>(`${base}/stretches/${id}`),

  // routines (nested items; PUT with items replaces them all)
  routines: (includeArchived = false) =>
    http.get<RoutineWithItems[]>(`${base}/routines${includeArchived ? "?includeArchived=1" : ""}`),
  createRoutine: (input: RoutineInput) => http.post<RoutineWithItems>(`${base}/routines`, input),
  updateRoutine: (id: number, patch: Partial<RoutineInput> & { archived?: 0 | 1 | boolean }) =>
    http.put<RoutineWithItems>(`${base}/routines/${id}`, patch),
  deleteRoutine: (id: number) => http.del<{ ok: boolean }>(`${base}/routines/${id}`),

  // sessions
  sessions: (days = 30) => http.get<MobilitySession[]>(`${base}/sessions?days=${days}`),
  createSession: (input: SessionInput) => http.post<MobilitySession>(`${base}/sessions`, input),
  updateSession: (id: number, patch: Partial<SessionInput>) =>
    http.put<MobilitySession>(`${base}/sessions/${id}`, patch),
  deleteSession: (id: number) => http.del<{ ok: boolean }>(`${base}/sessions/${id}`),

  // qualitative metrics
  metrics: () => http.get<MobilityMetric[]>(`${base}/metrics`),
  createMetric: (input: MetricInput) => http.post<MobilityMetric>(`${base}/metrics`, input),
  updateMetric: (id: number, patch: Partial<MetricInput> & { active?: 0 | 1 | boolean }) =>
    http.put<MobilityMetric>(`${base}/metrics/${id}`, patch),
  deleteMetric: (id: number) => http.del<{ ok: boolean }>(`${base}/metrics/${id}`),

  // assessments (1-10 ratings of a metric on a date)
  assessments: (opts: { days?: number; metricId?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.days !== undefined) params.set("days", String(opts.days));
    if (opts.metricId !== undefined) params.set("metricId", String(opts.metricId));
    const qs = params.toString();
    return http.get<MobilityAssessment[]>(`${base}/assessments${qs ? `?${qs}` : ""}`);
  },
  createAssessment: (input: AssessmentInput) =>
    http.post<MobilityAssessment>(`${base}/assessments`, input),
  deleteAssessment: (id: number) => http.del<{ ok: boolean }>(`${base}/assessments/${id}`),
};
