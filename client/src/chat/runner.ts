/**
 * Module-level chat turn runner. A coach turn started here belongs to the app,
 * not to the chat card that started it: it keeps running while the user
 * navigates to other pages (the card unmounts, the request doesn't), and its
 * outcome is held until a chat card for that agent comes back and consumes it.
 *
 * One turn per agent at a time — the UI disables sending while a turn runs,
 * and every segment has exactly one chat card.
 *
 * Note: this survives in-app navigation and (on desktop) background tabs. If
 * the OS suspends the browser entirely (phone locked / app switched away for a
 * while), the request is frozen with the page and settles when the page
 * resumes; the conversation itself is persisted server/DB-side as the turn
 * progresses, so nothing already said is ever lost.
 */
import { agentsApi } from "../api/agents";
import type { AgentName } from "@shared/types";

export interface ChatTurn {
  agent: AgentName;
  /** Conversation targeted at send time; undefined = start a new conversation. */
  conversationId?: number;
  /** The user message this turn is delivering. */
  text: string;
  status: "running" | "done" | "error";
  /** Set on success — the conversation the reply was persisted to. */
  resultConversationId?: number;
  error?: string;
}

const turns = new Map<AgentName, ChatTurn>();
const listeners = new Map<AgentName, Set<() => void>>();

function notify(agent: AgentName): void {
  for (const fn of listeners.get(agent) ?? []) fn();
}

/** Subscribe to turn-state changes for one agent. Returns an unsubscribe fn. */
export function subscribeChat(agent: AgentName, fn: () => void): () => void {
  let set = listeners.get(agent);
  if (!set) {
    set = new Set();
    listeners.set(agent, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export function getChatTurn(agent: AgentName): ChatTurn | undefined {
  return turns.get(agent);
}

/** Drop a settled turn once the UI has consumed its outcome. */
export function clearChatTurn(agent: AgentName): void {
  const t = turns.get(agent);
  if (t && t.status !== "running") turns.delete(agent);
}

/** Start a turn. No-op if one is already running for this agent. */
export function sendChat(agent: AgentName, text: string, conversationId?: number): void {
  if (turns.get(agent)?.status === "running") return;
  const turn: ChatTurn = { agent, conversationId, text, status: "running" };
  turns.set(agent, turn);
  notify(agent);
  agentsApi
    .chat(agent, text, conversationId)
    .then((res) => {
      turn.status = "done";
      turn.resultConversationId = res.conversationId;
    })
    .catch((err) => {
      turn.status = "error";
      turn.error = err instanceof Error ? err.message : "Failed to reach the agent";
    })
    .finally(() => notify(agent));
}
