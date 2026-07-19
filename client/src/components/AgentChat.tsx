/**
 * Shared chat panel used by every segment page and the dashboard.
 * Handles conversation selection/persistence, sending, and error states.
 */
import { useEffect, useRef, useState } from "react";
import { agentsApi } from "../api/agents";
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
  const [conversationId, setConversationId] = useState<number | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    agentsApi.status().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
    refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agent]);

  useEffect(() => {
    if (conversationId) {
      agentsApi.messages(conversationId).then(setMessages).catch(() => setMessages([]));
    } else {
      setMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  function refreshConversations() {
    agentsApi.conversations(props.agent).then(setConversations).catch(() => {});
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((m) => [
      ...m,
      { id: -Date.now(), role: "user", text, toolEvents: [], createdAt: new Date().toISOString() },
    ]);
    try {
      const res = await agentsApi.chat(props.agent, text, conversationId);
      setConversationId(res.conversationId);
      const all = await agentsApi.messages(res.conversationId);
      setMessages(all);
      refreshConversations();
      props.onReply?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach the agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>{props.title}</h3>
        <div className="row">
          <select
            className="input"
            style={{ width: 180, padding: "3px 8px", fontSize: 12 }}
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
              onClick={async () => {
                await agentsApi.deleteConversation(conversationId);
                setConversationId(undefined);
                refreshConversations();
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {enabled === false && (
        <p className="empty">
          AI assistants are disabled — set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and
          restart the server.
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
