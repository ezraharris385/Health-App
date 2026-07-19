/**
 * Local-mode health check: mirrors GET /api/health from server/index.ts.
 */
import { get } from "../router";
import { hasApiKey } from "@shared/agents/anthropic";

export function registerRoutesHealth(): void {
  get("/api/health", () => ({ ok: true, aiEnabled: hasApiKey() }));
}
