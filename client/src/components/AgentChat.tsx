/**
 * Shared chat panel used by every segment page and the dashboard.
 * Handles conversation selection/persistence, sending, and error states.
 *
 * Sending goes through the module-level chat runner (../chat/runner), so a
 * turn keeps running when the user navigates to another page mid-reply; when
 * they come back, this card re-attaches to the in-flight turn (or consumes its
 * finished result).
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { agentsApi } from "../api/agents";
import {
  clearChatTurn,
  getChatTurn,
  getLastConversationId,
  rememberConversationId,
  sendChat,
  subscribeChat,
} from "../chat/runner";
import type { AgentConversation, AgentName, ChatMessage } from "@shared/types";

export function AgentChat(props: {
  agent: AgentName;
  title: string;
  placeholder?: string;
  /** Called after the agent replies (data may have changed via tools). */
  onReply?: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  // Start from the agent's last-selected conversation — another page's card for
  // the same agent may have consumed a turn (and its outcome) since we unmounted.
  const [conversationId, setConversationId] = useState<number | undefined>(() =>
    getLastConversationId(props.agent),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, bumpTurnState] = useReducer((n: number) => n + 1, 0);
  const logRef = useRef<HTMLDivElement>(null);

  const turn = getChatTurn(props.agent);
  const busy = turn?.status === "running";

  useEffect(() => {
    agentsApi.status().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
    refreshConversations();
    // If a turn for this agent is still running, restore the conversation it
    // targets — a card remounted mid-turn must show the history the turn is
    // appending to, not an empty "New conversation".
    const running = getChatTurn(props.agent);
    if (running?.status === "running" && running.conversationId) {
      setConversationId(running.conversationId);
    }
    // Re-attach to the in-flight/settled turn for this agent (if any) and
    // re-render whenever its state changes — even while this card is the one
    // that started it.
    const unsubscribe = subscribeChat(props.agent, bumpTurnState);
    bumpTurnState();
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agent]);

  useEffect(() => {
    if (conversationId) {
      agentsApi.messages(conversationId).then(setMessages).catch(() => setMessages([]));
    } else {
      setMessages([]);
    }
    // Keep the runner's per-agent memory in sync so the next card mounted for
    // this agent (possibly on another page) restores the same conversation.
    rememberConversationId(props.agent, conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Consume a settled turn: apply its outcome exactly once, whichever card
  // instance happens to be mounted when it finishes (or when the user returns).
  useEffect(() => {
    const t = getChatTurn(props.agent);
    if (!t || t.status === "running") return;
    clearChatTurn(props.agent);
    if (t.status === "done" && t.resultConversationId) {
      setError(null);
      setConversationId(t.resultConversationId);
      agentsApi.messages(t.resultConversationId).then(setMessages).catch(() => {});
      refreshConversations();
      props.onReply?.();
    } else if (t.status === "error") {
      setError(t.error ?? "Failed to reach the agent");
      // Put the message back so it isn't lost (unless they typed something
      // new meanwhile), and re-sync — the turn may have been partially
      // persisted even though the request failed.
      setInput((cur) => (cur.trim() ? cur : t.text));
      if (t.conversationId) {
        setConversationId(t.conversationId);
        agentsApi.messages(t.conversationId).then(setMessages).catch(() => {});
      }
      refreshConversations();
    }
  });

  // When the tab/PWA becomes visible again, re-sync the conversation — a reply
  // may have been persisted while the page was frozen in the background.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (getChatTurn(props.agent)?.status === "running") return;
      if (conversationId) {
        agentsApi.messages(conversationId).then(setMessages).catch(() => {});
      }
      refreshConversations();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agent, conversationId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  function refreshConversations() {
    agentsApi.conversations(props.agent).then(setConversations).catch(() => {});
  }

  function send() {
    const text = input.trim();
    if (!text || busy || enabled === false) return;
    setInput("");
    setError(null);
    sendChat(props.agent, text, conversationId, messages[messages.length - 1]?.id);
  }

  // While a turn runs, show its user message as a pending bubble — unless the
  // refetched history already contains it (it gets persisted as the turn
  // runs). Only messages persisted after the send count as "it": an identical
  // message earlier in the conversation (a repeated "yes"/"thanks") must not
  // suppress the bubble.
  const showPending =
    busy &&
    turn !== undefined &&
    !messages.some(
      (m) =>
        m.role === "user" &&
        m.text === turn.text &&
        (turn.sinceMessageId === undefined || m.id > turn.sinceMessageId),
    );

  return (
    <div className="card">
      <div className="row between">
        <h3>{props.title}</h3>
        <div className="row">
          <select
            className="input chat-conv-select"
            disabled={busy}
            value={conversationId ?? ""}
            onChange={(e) =>
              setConversationId(e.target.value ? Number(e.target.value) : undefined)
            }
          >
            <option value="">New conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {conversationId && (
            <button
              className="btn small danger"
              disabled={busy}
              onClick={async () => {
                try {
                  await agentsApi.deleteConversation(conversationId);
                  setConversationId(undefined);
                  setError(null);
                  refreshConversations();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to delete conversation");
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {enabled === false && (
        <p className="empty">
          {import.meta.env.VITE_LOCAL_MODE === "1" ? (
            <>AI assistants are disabled — add your Anthropic API key in Settings to enable them.</>
          ) : (
            <>
              AI assistants are disabled — set <code>ANTHROPIC_API_KEY</code> in <code>.env</code>{" "}
              and restart the server.
            </>
          )}
        </p>
      )}

      <div className="chat">
        <div className="chat-log" ref={logRef}>
          {messages.length === 0 && !busy && (
            <p className="empty">{props.placeholder ?? "Ask me anything about this area."}</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.text}
              {m.toolEvents.length > 0 && (
                <span className="tool-events">used: {[...new Set(m.toolEvents)].join(", ")}</span>
              )}
            </div>
          ))}
          {showPending && <div className="msg user">{turn.text}</div>}
          {busy && <div className="thinking-dots">thinking…</div>}
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="chat-input">
          <textarea
            className="input"
            rows={2}
            value={input}
            placeholder={enabled === false ? "AI disabled" : "Message…"}
            disabled={enabled === false || busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn primary" onClick={send} disabled={busy || enabled === false}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
