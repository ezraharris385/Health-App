/**
 * Local-mode agents API: registers in-browser handlers for exactly the routes
 * server/routes/agents.ts serves. The agent turns run fully in the browser —
 * shared/agents/framework talks to the Anthropic API with the on-device key
 * injected by boot.ts. Same params, validation, status codes, and error
 * shapes as the Express router (the 503 message is mode-appropriate: the key
 * lives in Settings here, not .env).
 */
import Anthropic from "@anthropic-ai/sdk";
import { del, get, post, LocalApiError } from "../router";
import { db } from "@shared/data/db";
import { hasApiKey } from "@shared/agents/anthropic";
import { getAgent } from "@shared/agents/registry";
import {
  listConversationMessages,
  listMemory,
  runAgentTurn,
} from "@shared/agents/framework";
import type { AgentName, ChatRequest } from "@shared/types";

export function registerRoutesAgents(): void {
  get("/api/agents/status", () => ({ enabled: hasApiKey() }));

  get("/api/agents/:agent/conversations", ({ params }) => {
    const agent = params.agent as AgentName;
    if (!getAgent(agent)) throw new LocalApiError(404, "Unknown agent");
    return db
      .prepare(
        "SELECT id, agent, title, created_at AS createdAt, updated_at AS updatedAt FROM agent_conversations WHERE agent = ? ORDER BY updated_at DESC LIMIT 50",
      )
      .all(agent);
  });

  get("/api/agents/conversations/:id/messages", ({ params }) =>
    listConversationMessages(Number(params.id)),
  );

  del("/api/agents/conversations/:id", ({ params }) => {
    db.prepare("DELETE FROM agent_conversations WHERE id = ?").run(Number(params.id));
    return { ok: true };
  });

  get("/api/agents/:agent/memory", ({ params }) => {
    const agent = params.agent as AgentName;
    if (!getAgent(agent)) throw new LocalApiError(404, "Unknown agent");
    return listMemory(agent);
  });

  del("/api/agents/:agent/memory/:id", ({ params }) => {
    db.prepare("DELETE FROM agent_memory WHERE id = ? AND agent = ?").run(
      Number(params.id),
      params.agent,
    );
    return { ok: true };
  });

  post("/api/agents/:agent/chat", async ({ params, body }) => {
    const agentName = params.agent as AgentName;
    const def = getAgent(agentName);
    if (!def) throw new LocalApiError(404, "Unknown agent");
    if (!hasApiKey()) {
      throw new LocalApiError(
        503,
        "AI assistants are disabled: no Anthropic API key is set. Add your API key in Settings.",
      );
    }
    const req = body as ChatRequest;
    if (!req?.message || typeof req.message !== "string" || !req.message.trim()) {
      throw new LocalApiError(400, "message is required");
    }
    if (req.conversationId !== undefined && req.conversationId !== null) {
      const convId = Number(req.conversationId);
      if (!Number.isInteger(convId) || convId <= 0) {
        throw new LocalApiError(400, "conversationId must be a positive integer");
      }
      const conv = db
        .prepare("SELECT agent FROM agent_conversations WHERE id = ?")
        .get(convId) as { agent: string } | undefined;
      if (!conv) {
        throw new LocalApiError(404, `Conversation #${convId} no longer exists`);
      }
      if (conv.agent !== agentName) {
        throw new LocalApiError(400, `Conversation #${convId} belongs to the ${conv.agent} agent`);
      }
    }
    try {
      return await runAgentTurn(
        def,
        req.conversationId ? Number(req.conversationId) : undefined,
        req.message.trim(),
      );
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        const status = err.status ?? 500;
        const friendly =
          err instanceof Anthropic.AuthenticationError
            ? "Anthropic API key is invalid."
            : err instanceof Anthropic.RateLimitError
              ? "Rate limited by the Anthropic API — wait a moment and retry."
              : `Anthropic API error (${status}): ${err.message}`;
        throw new LocalApiError(502, friendly);
      }
      console.error("Agent turn failed:", err);
      throw new LocalApiError(500, err instanceof Error ? err.message : "Agent turn failed");
    }
  });
}
