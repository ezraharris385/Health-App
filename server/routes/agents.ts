import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { hasApiKey } from "../anthropic";
import { getAgent } from "../agents/registry";
import { listConversationMessages, listMemory, runAgentTurn } from "../agents/framework";
import type { AgentName, ChatRequest } from "../../shared/types";

export const agentsRouter = Router();

agentsRouter.get("/status", (_req, res) => {
  res.json({ enabled: hasApiKey() });
});

agentsRouter.get("/:agent/conversations", (req, res) => {
  const agent = req.params.agent as AgentName;
  if (!getAgent(agent)) return res.status(404).json({ error: "Unknown agent" });
  const rows = db
    .prepare(
      "SELECT id, agent, title, created_at AS createdAt, updated_at AS updatedAt FROM agent_conversations WHERE agent = ? ORDER BY updated_at DESC LIMIT 50",
    )
    .all(agent);
  res.json(rows);
});

agentsRouter.get("/conversations/:id/messages", (req, res) => {
  const id = Number(req.params.id);
  res.json(listConversationMessages(id));
});

agentsRouter.delete("/conversations/:id", (req, res) => {
  db.prepare("DELETE FROM agent_conversations WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

agentsRouter.get("/:agent/memory", (req, res) => {
  const agent = req.params.agent as AgentName;
  if (!getAgent(agent)) return res.status(404).json({ error: "Unknown agent" });
  res.json(listMemory(agent));
});

agentsRouter.delete("/:agent/memory/:id", (req, res) => {
  db.prepare("DELETE FROM agent_memory WHERE id = ? AND agent = ?").run(
    Number(req.params.id),
    req.params.agent,
  );
  res.json({ ok: true });
});

agentsRouter.post("/:agent/chat", async (req, res) => {
  const agentName = req.params.agent as AgentName;
  const def = getAgent(agentName);
  if (!def) return res.status(404).json({ error: "Unknown agent" });
  if (!hasApiKey()) {
    return res.status(503).json({
      error:
        "AI assistants are disabled: ANTHROPIC_API_KEY is not set. Add it to .env and restart.",
    });
  }
  const body = req.body as ChatRequest;
  if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  if (body.conversationId !== undefined && body.conversationId !== null) {
    const convId = Number(body.conversationId);
    if (!Number.isInteger(convId) || convId <= 0) {
      return res.status(400).json({ error: "conversationId must be a positive integer" });
    }
    const conv = db
      .prepare("SELECT agent FROM agent_conversations WHERE id = ?")
      .get(convId) as { agent: string } | undefined;
    if (!conv) {
      return res.status(404).json({ error: `Conversation #${convId} no longer exists` });
    }
    if (conv.agent !== agentName) {
      return res
        .status(400)
        .json({ error: `Conversation #${convId} belongs to the ${conv.agent} agent` });
    }
  }
  try {
    const result = await runAgentTurn(
      def,
      body.conversationId ? Number(body.conversationId) : undefined,
      body.message.trim(),
    );
    res.json(result);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 500;
      const friendly =
        err instanceof Anthropic.AuthenticationError
          ? "Anthropic API key is invalid."
          : err instanceof Anthropic.RateLimitError
            ? "Rate limited by the Anthropic API — wait a moment and retry."
            : `Anthropic API error (${status}): ${err.message}`;
      return res.status(502).json({ error: friendly });
    }
    console.error("Agent turn failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Agent turn failed" });
  }
});
