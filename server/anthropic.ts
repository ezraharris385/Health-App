/**
 * Node runtime Anthropic wiring: env-based key, injected into the shared
 * provider. Re-exports keep existing `import ... from "../anthropic"` sites
 * working unchanged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { setAnthropicProvider } from "../shared/agents/anthropic";

let client: Anthropic | null = null;

setAnthropicProvider(
  () => {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    if (!client) client = new Anthropic();
    return client;
  },
  process.env.AGENT_MODEL || "claude-opus-4-8",
);

export { getAnthropic, hasApiKey, agentModel } from "../shared/agents/anthropic";
export const AGENT_MODEL = process.env.AGENT_MODEL || "claude-opus-4-8";
