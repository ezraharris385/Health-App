/**
 * Agent framework: every segment agent (workout, nutrition, sleep, vitamins)
 * and the master agent run through this. It provides:
 *  - a manual tool-use loop on the Anthropic Messages API (claude-opus-4-8,
 *    adaptive thinking)
 *  - persistent memory notes per agent (agent_memory table), injected into the
 *    system prompt every turn and editable by the agent through memory tools
 *  - conversation persistence (agent_conversations / agent_messages) so every
 *    agent retains full history across app restarts
 *  - a per-turn data-context snapshot injected into the user turn
 */
import Anthropic from "@anthropic-ai/sdk";
import { agentModel, getAnthropic } from "./anthropic";
import { db, todayStr } from "../data/db";
import type { AgentMemoryNote, AgentName, ChatMessage } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Return a string result (JSON.stringify structured data). Throw on error. */
  run: (input: any) => string | Promise<string>;
}

export interface AgentDef {
  name: AgentName;
  title: string;
  /** Stable persona + behavioral guidance. Keep frozen — dynamic data goes in buildContext(). */
  persona: string;
  tools: ToolDef[];
  /** Fresh snapshot of today's relevant data, injected into each user turn. */
  buildContext: () => string;
}

const MAX_TOOL_ITERATIONS = 16;
const MAX_HISTORY_TURNS = 12; // user turns of history replayed to the model

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function listMemory(agent: AgentName): AgentMemoryNote[] {
  return db
    .prepare("SELECT * FROM agent_memory WHERE agent = ? ORDER BY id")
    .all(agent)
    .map((r: any) => ({
      id: r.id,
      agent: r.agent,
      category: r.category,
      content: r.content,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

function memoryTools(agent: AgentName): ToolDef[] {
  return [
    {
      name: "save_memory",
      description:
        "Save a durable memory note about the user (preferences, goals, constraints, injuries, patterns you noticed, decisions made). Memories persist across all future conversations — save anything worth remembering. Keep each note short and self-contained.",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The note to remember" },
          category: {
            type: "string",
            description: "Short category, e.g. 'preference', 'goal', 'constraint', 'pattern'",
          },
        },
        required: ["content"],
      },
      run: (input: { content: string; category?: string }) => {
        const info = db
          .prepare("INSERT INTO agent_memory (agent, category, content) VALUES (?, ?, ?)")
          .run(agent, input.category ?? "general", input.content);
        return `Saved memory #${info.lastInsertRowid}.`;
      },
    },
    {
      name: "update_memory",
      description: "Update an existing memory note by id (replaces its content).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "number" },
          content: { type: "string" },
        },
        required: ["id", "content"],
      },
      run: (input: { id: number; content: string }) => {
        const info = db
          .prepare(
            "UPDATE agent_memory SET content = ?, updated_at = datetime('now') WHERE id = ? AND agent = ?",
          )
          .run(input.content, input.id, agent);
        return info.changes ? `Updated memory #${input.id}.` : `No memory #${input.id} found.`;
      },
    },
    {
      name: "delete_memory",
      description: "Delete a memory note by id (use when a note is wrong or obsolete).",
      input_schema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
      run: (input: { id: number }) => {
        const info = db
          .prepare("DELETE FROM agent_memory WHERE id = ? AND agent = ?")
          .run(input.id, agent);
        return info.changes ? `Deleted memory #${input.id}.` : `No memory #${input.id} found.`;
      },
    },
  ];
}

function memoryBlock(agent: AgentName): string {
  const notes = listMemory(agent);
  if (notes.length === 0) {
    return "You have no saved memories yet. Use save_memory whenever you learn something durable about the user.";
  }
  const lines = notes.map((n) => `- [#${n.id}] (${n.category}) ${n.content}`);
  return `Your saved memories about the user (maintain these with save_memory / update_memory / delete_memory):\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Conversation persistence
// ---------------------------------------------------------------------------

function createConversation(agent: AgentName, firstMessage: string): number {
  const title = firstMessage.slice(0, 60) + (firstMessage.length > 60 ? "…" : "");
  const info = db
    .prepare("INSERT INTO agent_conversations (agent, title) VALUES (?, ?)")
    .run(agent, title);
  return Number(info.lastInsertRowid);
}

function persistMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: unknown,
  displayText: string,
  toolEvents: string[] = [],
): number {
  const info = db
    .prepare(
      `INSERT INTO agent_messages (conversation_id, role, content_json, display_text, tool_events_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(conversationId, role, JSON.stringify(content), displayText, JSON.stringify(toolEvents));
  db.prepare("UPDATE agent_conversations SET updated_at = datetime('now') WHERE id = ?").run(
    conversationId,
  );
  return Number(info.lastInsertRowid);
}

/**
 * Rebuild the API message array from persisted rows, windowed to the last
 * MAX_HISTORY_TURNS real user turns. Cutting only at real-user-turn boundaries
 * keeps tool_use/tool_result pairs intact.
 */
function loadApiMessages(conversationId: number): Anthropic.MessageParam[] {
  const rows = db
    .prepare(
      "SELECT role, content_json, display_text FROM agent_messages WHERE conversation_id = ? ORDER BY id",
    )
    .all(conversationId) as { role: "user" | "assistant"; content_json: string; display_text: string }[];

  // Indices of "real" user turns (user rows carrying display text, not tool results)
  const userTurnIdx = rows
    .map((r, i) => (r.role === "user" && r.display_text !== "" ? i : -1))
    .filter((i) => i >= 0);
  const start =
    userTurnIdx.length > MAX_HISTORY_TURNS
      ? userTurnIdx[userTurnIdx.length - MAX_HISTORY_TURNS]
      : 0;

  return rows.slice(start).map((r) => ({
    role: r.role,
    content: JSON.parse(r.content_json),
  }));
}

export function listConversationMessages(conversationId: number): ChatMessage[] {
  const rows = db
    .prepare(
      "SELECT id, role, display_text, tool_events_json, created_at FROM agent_messages WHERE conversation_id = ? ORDER BY id",
    )
    .all(conversationId) as any[];
  return rows
    .filter((r) => r.display_text !== "")
    .map((r) => ({
      id: r.id,
      role: r.role,
      text: r.display_text,
      toolEvents: JSON.parse(r.tool_events_json),
      createdAt: r.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Core turn loop
// ---------------------------------------------------------------------------

export interface AgentTurnResult {
  conversationId: number;
  reply: ChatMessage;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function systemBlocks(def: AgentDef): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: def.persona,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: memoryBlock(def.name),
    },
  ];
}

async function runToolLoop(
  def: AgentDef,
  messages: Anthropic.MessageParam[],
  onMessage?: (role: "user" | "assistant", content: unknown, display: string, tools: string[]) => void,
  exhaustedMessage?: string,
): Promise<{ text: string; toolEvents: string[] }> {
  const client = getAnthropic();
  const tools: ToolDef[] = [...def.tools, ...memoryTools(def.name)];
  const apiTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const toolEvents: string[] = [];
  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: agentModel(),
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: systemBlocks(def),
      tools: apiTools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      finalText =
        extractText(response.content) ||
        "I can't help with that request. Could we approach it differently?";
      // A refusal can arrive with empty content; persisting `[]` as an
      // assistant message would 400 every subsequent turn on replay.
      const persistable =
        response.content.length > 0
          ? response.content
          : [{ type: "text" as const, text: finalText }];
      onMessage?.("assistant", persistable, finalText, toolEvents);
      messages.push({ role: "assistant", content: persistable });
      return { text: finalText, toolEvents };
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      onMessage?.("assistant", response.content, "", toolEvents);
      continue;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      onMessage?.("assistant", response.content, "", toolUses.map((t) => t.name));

      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          toolEvents.push(tu.name);
          const tool = toolByName.get(tu.name);
          try {
            if (!tool) throw new Error(`Unknown tool: ${tu.name}`);
            const result = await tool.run(tu.input);
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: String(result),
            };
          } catch (err) {
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Error: ${err instanceof Error ? err.message : String(err)}`,
              is_error: true,
            };
          }
        }),
      );
      messages.push({ role: "user", content: results });
      onMessage?.("user", results, "", []);
      continue;
    }

    // end_turn / max_tokens
    finalText = extractText(response.content);
    if (response.stop_reason === "max_tokens") {
      finalText += "\n\n_(Response was cut off by the length limit.)_";
    }
    messages.push({ role: "assistant", content: response.content });
    onMessage?.("assistant", response.content, finalText, toolEvents);

    // A max_tokens cutoff can leave dangling tool_use blocks. Replaying an
    // assistant tool_use without a matching tool_result 400s forever — close
    // them out with error results so the conversation stays valid.
    const dangling = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (dangling.length > 0) {
      const closers: Anthropic.ToolResultBlockParam[] = dangling.map((tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: "Tool call was not executed — the response was cut off by the length limit.",
        is_error: true,
      }));
      messages.push({ role: "user", content: closers });
      onMessage?.("user", closers, "", []);
    }
    return { text: finalText, toolEvents };
  }

  // Tool-iteration budget exhausted without a final text turn.
  const fallback =
    exhaustedMessage ??
    "I hit my tool-use limit for this request before finishing. Ask me to continue and I'll pick up where I left off.";
  const fallbackContent = [{ type: "text" as const, text: fallback }];
  messages.push({ role: "assistant", content: fallbackContent });
  onMessage?.("assistant", fallbackContent, fallback, toolEvents);
  return { text: fallback, toolEvents };
}

/**
 * Run one persisted conversational turn for an agent.
 * Turns on the same conversation are serialized: two simultaneous sends would
 * otherwise interleave persisted API messages and corrupt the replay order.
 */
const conversationLocks = new Map<number, Promise<unknown>>();

export async function runAgentTurn(
  def: AgentDef,
  conversationId: number | undefined,
  userMessage: string,
): Promise<AgentTurnResult> {
  const convId = conversationId ?? createConversation(def.name, userMessage);
  const prev = conversationLocks.get(convId) ?? Promise.resolve();
  const job = prev
    .catch(() => {})
    .then(() => runAgentTurnLocked(def, convId, userMessage));
  conversationLocks.set(convId, job);
  try {
    return await job;
  } finally {
    if (conversationLocks.get(convId) === job) conversationLocks.delete(convId);
  }
}

async function runAgentTurnLocked(
  def: AgentDef,
  convId: number,
  userMessage: string,
): Promise<AgentTurnResult> {
  const messages = loadApiMessages(convId);
  const context = safeContext(def);
  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `<context date="${todayStr()}">\nAuto-injected snapshot of the user's current data (not written by the user):\n${context}\n</context>\n\n${userMessage}`,
    },
  ];
  messages.push({ role: "user", content: userContent });
  persistMessage(convId, "user", userContent, userMessage);

  const { text, toolEvents } = await runToolLoop(def, messages, (role, content, display, tools) => {
    // Persist every intermediate API message so the conversation replays exactly.
    if (role === "assistant" || display === "") {
      persistMessage(convId, role, content, display, tools);
    }
  });

  const lastAssistant = db
    .prepare(
      "SELECT id, created_at FROM agent_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1",
    )
    .get(convId) as { id: number; created_at: string } | undefined;

  return {
    conversationId: convId,
    reply: {
      id: lastAssistant?.id ?? 0,
      role: "assistant",
      text,
      toolEvents,
      createdAt: lastAssistant?.created_at ?? new Date().toISOString(),
    },
  };
}

/**
 * Run a one-shot, non-persisted consultation of an agent (used by the master
 * agent to pull segment agents into a joint task). The consulted agent has its
 * full toolset and memory, so it can read live data and even record learnings.
 */
export async function consultAgent(def: AgentDef, question: string): Promise<string> {
  const context = safeContext(def);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `<context date="${todayStr()}">\n${context}\n</context>\n\nYou are being consulted by the master health coordinator agent on behalf of the user. Answer with concrete, specific data and recommendations — your reply goes to another agent, not directly to the user, so be dense and factual.\n\nQuestion: ${question}`,
    },
  ];
  const { text } = await runToolLoop(
    def,
    messages,
    undefined,
    "(Consultation incomplete: the specialist hit its tool-use limit before producing a final answer. Treat any partial information as unverified.)",
  );
  return text;
}

function safeContext(def: AgentDef): string {
  try {
    return def.buildContext();
  } catch (err) {
    return `(context unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }
}
