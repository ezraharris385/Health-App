/**
 * Local-mode bootstrap: initializes the wasm SQLite DB, wires the on-device
 * Anthropic key into the shared agent runtime, and registers every in-browser
 * API dispatcher so client/src/api/* works without a server.
 *
 * The API key lives only in this browser's localStorage — it is the user's
 * own key, entered on and stored only on their device, which is why
 * dangerouslyAllowBrowser is acceptable for this single-user app.
 */
import Anthropic from "@anthropic-ai/sdk";
import { setAnthropicProvider } from "@shared/agents/anthropic";
import { initSqljsDb } from "./sqljsDb";
import { registerRoutesWorkout } from "./api/workout";
import { registerRoutesNutrition } from "./api/nutrition";
import { registerRoutesSleep } from "./api/sleep";
import { registerRoutesVitamins } from "./api/vitamins";
import { registerRoutesDashboard } from "./api/dashboard";
import { registerRoutesAgents } from "./api/agents";
import { registerRoutesSettings } from "./api/settings";
import { registerRoutesHealth } from "./api/health";

const API_KEY_STORAGE = "darfum-api-key";

/** The Anthropic API key stored on this device, or null if not set. */
export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

/** Store (or clear, with null/empty) the on-device Anthropic API key. */
export function setStoredApiKey(key: string | null): void {
  try {
    const trimmed = key?.trim();
    if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* storage unavailable (private mode) — the key just won't persist */
  }
}

// Cache the client per key so each agent turn doesn't rebuild it, but a
// changed key (saved in Settings) takes effect on the next call.
let cachedClient: Anthropic | null = null;
let cachedKey: string | null = null;

function anthropicProvider(): Anthropic | null {
  const key = getStoredApiKey();
  if (!key) {
    cachedClient = null;
    cachedKey = null;
    return null;
  }
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    cachedKey = key;
  }
  return cachedClient;
}

export async function initLocalBackend(): Promise<void> {
  await initSqljsDb();
  setAnthropicProvider(anthropicProvider);

  registerRoutesWorkout();
  registerRoutesNutrition();
  registerRoutesSleep();
  registerRoutesVitamins();
  registerRoutesDashboard();
  registerRoutesAgents();
  registerRoutesSettings();
  registerRoutesHealth();
}
