import { http } from "./http";
import type { Settings } from "@shared/types";

export const settingsApi = {
  get: () => http.get<Settings>("/api/settings"),
  save: (patch: Partial<Settings>) => http.put<Settings>("/api/settings", patch),
};
