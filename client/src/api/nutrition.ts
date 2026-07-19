import { http } from "./http";
import type {
  DailyNutritionSummary,
  Food,
  FoodLog,
  MealType,
  MicroMap,
  UserGoals,
  WaterLog,
  WeightLog,
} from "@shared/types";

export interface FoodInput {
  name: string;
  brand?: string;
  servingSize?: number;
  servingUnit?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  micros?: MicroMap;
}

export interface MacroHistoryDay {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MacroHistoryResponse {
  days: MacroHistoryDay[];
  goals: UserGoals;
}

export interface WaterSummary {
  date: string;
  totalMl: number;
  goalMl: number;
  entries: WaterLog[];
}

export interface WaterHistoryResponse {
  days: { date: string; totalMl: number }[];
  goalMl: number;
}

export interface WeightHistoryResponse {
  entries: WeightLog[];
  weightGoal: number | null;
  weightUnit: "lb" | "kg";
}

export const nutritionApi = {
  // Food library
  foods: (q?: string) =>
    http.get<Food[]>(`/api/nutrition/foods${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createFood: (input: FoodInput) => http.post<Food>("/api/nutrition/foods", input),
  updateFood: (id: number, patch: Partial<FoodInput>) =>
    http.put<Food>(`/api/nutrition/foods/${id}`, patch),
  deleteFood: (id: number) => http.del<{ ok: boolean }>(`/api/nutrition/foods/${id}`),

  // Daily summary + food log
  summary: (date: string) =>
    http.get<DailyNutritionSummary>(`/api/nutrition/summary?date=${date}`),
  logFood: (input: { date: string; foodId: number; servings: number; meal: MealType }) =>
    http.post<FoodLog>("/api/nutrition/log", input),
  deleteLog: (id: number) => http.del<{ ok: boolean }>(`/api/nutrition/log/${id}`),

  // History
  history: (days = 30) => http.get<MacroHistoryResponse>(`/api/nutrition/history?days=${days}`),

  // Water
  water: (date: string) => http.get<WaterSummary>(`/api/nutrition/water?date=${date}`),
  addWater: (input: { date: string; amountMl: number }) =>
    http.post<WaterLog>("/api/nutrition/water", input),
  deleteWater: (id: number) => http.del<{ ok: boolean }>(`/api/nutrition/water/${id}`),
  waterHistory: (days = 30) =>
    http.get<WaterHistoryResponse>(`/api/nutrition/water/history?days=${days}`),

  // Weight
  weight: (days = 90) => http.get<WeightHistoryResponse>(`/api/nutrition/weight?days=${days}`),
  logWeight: (input: { date: string; weight: number }) =>
    http.post<WeightLog>("/api/nutrition/weight", input),
  deleteWeight: (id: number) => http.del<{ ok: boolean }>(`/api/nutrition/weight/${id}`),
};
