import { http } from "./http";
import type { DailyScore, EnergyBalance, ScoreHistory } from "@shared/types";

/** Mirror of DashboardOverview in server/routes/dashboard.ts — keep in sync. */
export interface DashboardOverview {
  date: string;
  score: DailyScore;
  workout: {
    status: "trained" | "scheduled" | "rest";
    sessionCount: number;
    completedSessionCount: number;
    setCount: number;
    cardioCount: number;
    cardioDistanceKm: number;
    /** "<plan>: <day name>" for each plan day scheduled on this weekday */
    scheduledPlanDays: string[];
  };
  nutrition: {
    calories: number;
    calorieGoal: number;
    proteinG: number;
    proteinGoalG: number;
    mealsLogged: number;
  };
  water: { totalMl: number; goalMl: number };
  sleep: {
    logged: boolean;
    inProgress: boolean;
    durationHours: number | null;
    targetHours: number;
    quality: number | null;
  };
  vitamins: {
    averageCoveragePercent: number;
    nutrientsAtTarget: number;
    nutrientsTracked: number;
    supplementsTaken: number;
    activeSupplements: number;
  };
  mobility: {
    sessionCount: number;
    totalMinutes: number;
    kinds: string[];
    metricsTracked: number;
  };
  weight: {
    latest: number | null;
    date: string | null;
    unit: "lb" | "kg";
    goal: number | null;
  };
  goalStatement: string;
}

export const dashboardApi = {
  score: (date?: string) =>
    http.get<DailyScore>(`/api/dashboard/score${date ? `?date=${date}` : ""}`),
  history: (days = 30) => http.get<ScoreHistory>(`/api/dashboard/history?days=${days}`),
  overview: () => http.get<DashboardOverview>("/api/dashboard/overview"),
  energy: (date?: string) =>
    http.get<EnergyBalance>(`/api/dashboard/energy${date ? `?date=${date}` : ""}`),
};
