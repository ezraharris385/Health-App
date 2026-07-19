import { http } from "./http";
import type { SleepLog } from "@shared/types";

export interface SleepStateResponse {
  open: SleepLog | null;
  now: string;
}

export interface SleepLogInput {
  bedTime: string; // ISO datetime
  wakeTime: string; // ISO datetime
  quality?: number | null; // 1-5
  notes?: string;
}

export interface WakeInput {
  quality?: number | null;
  notes?: string;
}

export interface SleepHistoryDay {
  date: string;
  hours: number | null;
  quality: number | null;
}

export interface SleepHistoryResponse {
  days: SleepHistoryDay[];
  targetHours: number;
}

export interface SleepDayOfWeekStat {
  dow: number;
  label: string;
  avgHours: number | null;
  nights: number;
}

export interface SleepStats {
  days: number;
  nightsLogged: number;
  avgDurationHours: number | null;
  avgQuality: number | null;
  avgBedTime: string | null; // "HH:MM" local
  avgWakeTime: string | null;
  bedtimeStdDevMinutes: number | null;
  bedtimeDriftMinutes: number | null; // + = later
  targetHours: number;
  targetAdherencePct: number | null;
  byDayOfWeek: SleepDayOfWeekStat[];
}

export const sleepApi = {
  state: () => http.get<SleepStateResponse>("/api/sleep/state"),
  goToBed: () => http.post<SleepLog>("/api/sleep/bed"),
  wake: (input?: WakeInput) => http.post<SleepLog>("/api/sleep/wake", input ?? {}),
  logs: (days = 30) => http.get<SleepLog[]>(`/api/sleep/logs?days=${days}`),
  createLog: (input: SleepLogInput) => http.post<SleepLog>("/api/sleep/logs", input),
  updateLog: (id: number, patch: Partial<SleepLogInput>) =>
    http.put<SleepLog>(`/api/sleep/logs/${id}`, patch),
  deleteLog: (id: number) => http.del<{ ok: boolean }>(`/api/sleep/logs/${id}`),
  history: (days = 30) => http.get<SleepHistoryResponse>(`/api/sleep/history?days=${days}`),
  stats: (days = 30) => http.get<SleepStats>(`/api/sleep/stats?days=${days}`),
};
