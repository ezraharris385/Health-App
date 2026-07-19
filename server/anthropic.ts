import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic(): Anthropic {
  if (!client) {
    if (!hasApiKey()) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env to enable the AI assistants.",
      );
    }
    client = new Anthropic();
  }
  return client;
}

export const AGENT_MODEL = process.env.AGENT_MODEL || "claude-opus-4-8";
