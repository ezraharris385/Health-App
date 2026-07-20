/**
 * "Ask the coach to fill this in" bridge. The food creator does NOT call the
 * API itself — instead it hands a ready message here, pre-filling an editable
 * input the user reviews and sends to the Nutrition coach (which then estimates
 * full macros + micronutrients and creates the food). Sending goes through the
 * shared chat runner, exactly like the AgentChat below it, so the reply shows
 * up in the same conversation.
 */
import { useEffect, useReducer, useState } from "react";
import {
  getChatTurn,
  getLastConversationId,
  sendChat,
  subscribeChat,
} from "../../chat/runner";

export function CoachDraftCard(props: { draft: string; onSent: () => void; onDismiss: () => void }) {
  const [text, setText] = useState(props.draft);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // A fresh "Ask the coach" click replaces whatever was staged here.
  useEffect(() => {
    setText(props.draft);
  }, [props.draft]);

  // Reflect the nutrition agent's turn state so we don't double-send while a
  // turn is already running (the runner enforces one turn per agent anyway).
  useEffect(() => subscribeChat("nutrition", bump), []);
  const busy = getChatTurn("nutrition")?.status === "running";

  function send() {
    const msg = text.trim();
    if (!msg || busy) return;
    sendChat("nutrition", msg, getLastConversationId("nutrition"));
    props.onSent();
  }

  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <div className="row between">
        <h3>Draft for the Nutrition coach</h3>
        <button className="btn small" onClick={props.onDismiss} disabled={busy}>
          Dismiss
        </button>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>
        Review and send — the coach estimates full calories, macros, and micronutrients, then adds
        the food to your library.
      </p>
      <div className="chat-input">
        <textarea
          className="input"
          rows={2}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Send to coach"}
        </button>
      </div>
    </div>
  );
}
