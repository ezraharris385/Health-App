import { http } from "./http";
import type { DailyVitaminSummary, MicroMap, Supplement } from "@shared/types";

export interface CoverageHistoryPoint {
  date: string;
  /** mean coverage percent across all tracked nutrients (0-100) */
  avgPercent: number;
}

export interface AdherencePoint {
  date: string;
  takenCount: number;
  activeCount: number;
  percent: number;
}

export interface TakenState {
  date: string;
  supplementId: number;
  supplementName: string;
  taken: boolean;
}

export interface SupplementInput {
  name: string;
  nutrients: MicroMap;
  notes?: string;
  /** Per-dose macros — count toward Nutrition calories/macros on taken days. */
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

export const vitaminsApi = {
  summary: (date?: string) =>
    http.get<DailyVitaminSummary>(
      `/api/vitamins/summary${date ? `?date=${encodeURIComponent(date)}` : ""}`,
    ),
  history: (days = 30) => http.get<CoverageHistoryPoint[]>(`/api/vitamins/history?days=${days}`),
  adherence: (days = 30) => http.get<AdherencePoint[]>(`/api/vitamins/adherence?days=${days}`),
  supplements: () => http.get<Supplement[]>("/api/vitamins/supplements"),
  createSupplement: (input: SupplementInput) =>
    http.post<Supplement>("/api/vitamins/supplements", input),
  updateSupplement: (id: number, patch: Partial<SupplementInput> & { active?: 0 | 1 | boolean }) =>
    http.put<Supplement>(`/api/vitamins/supplements/${id}`, patch),
  deleteSupplement: (id: number) => http.del<{ ok: boolean }>(`/api/vitamins/supplements/${id}`),
  toggleTaken: (supplementId: number, date?: string, taken?: boolean) =>
    http.post<TakenState>("/api/vitamins/taken/toggle", { supplementId, date, taken }),
};
