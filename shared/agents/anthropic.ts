/**
 * Runtime-agnostic Anthropic client access. Each runtime injects a provider:
 *  - server: env ANTHROPIC_API_KEY (server/anthropic.ts)
 *  - browser: key stored on-device in localStorage, client constructed with
 *    dangerouslyAllowBrowser (client/src/local/boot.ts) — acceptable here
 *    because this is a single-user app and the key is the user's own,
 *    entered on and stored only on their device.
 */
import type Anthropic from "@anthropic-ai/sdk";

let provider: (() => Anthropic | null) | null = null;
let model = "claude-opus-4-8";

export function setAnthropicProvider(p: () => Anthropic | null, agentModel?: string): void {
  provider = p;
  if (agentModel) model = agentModel;
}

export function hasApiKey(): boolean {
  return provider?.() != null;
}

export function getAnthropic(): Anthropic {
  const client = provider?.();
  if (!client) {
    throw new Error(
      "No Anthropic API key configured. Add it in Settings (browser mode) or .env (server mode) to enable the AI assistants.",
    );
  }
  return client;
}

export function agentModel(): string {
  return model;
}
