import { useReducer } from "react";
import { AMADEUS_STAGE, STAGE_5_SERVICE_STATUSES, type ChatMessage } from "@amadeus/core";
import { FALLBACK_ASSET_DESCRIPTOR } from "@amadeus/renderer-static";
import { initialChatShellState, reduceChatShellState } from "./chat-shell";

export function App() {
  const [state, dispatch] = useReducer(reduceChatShellState, initialChatShellState);

  function sendMessage() {
    dispatch({
      type: "send",
      text: state.input,
      now: new Date().toISOString()
    });
  }

  return (
    <main className="amadeus-shell">
      <section className="pet-stage" aria-label="Desktop pet preview">
        <div className="stage-toolbar">
          <div>
            <p className="eyebrow">Amadeus</p>
            <h1>Local desk companion</h1>
          </div>
          <button className="icon-button" type="button" onClick={() => dispatch({ type: "toggle-chat" })}>
            {state.chatOpen ? "Hide" : "Chat"}
          </button>
        </div>

        <div className={`character-frame emotion-${state.character.emotion}`}>
          <div className={`fallback-character ${state.character.speaking ? "is-speaking" : ""}`}>
            <div className="hair hair-left" />
            <div className="hair hair-right" />
            <div className="head">
              <span className="eye eye-left" />
              <span className="eye eye-right" />
              <span className={`mouth ${state.character.mouthOpen ? "open" : ""}`} />
            </div>
            <div className="body" />
            <div className="ribbon" />
          </div>
          <span className="asset-label">{FALLBACK_ASSET_DESCRIPTOR.label}</span>
          <div className="character-shadow" />
        </div>

        <div className="status-strip">
          {STAGE_5_SERVICE_STATUSES.map((service) => (
            <div className={`status-pill state-${service.state}`} key={service.id}>
              <span>{service.label}</span>
              <strong>{service.detail}</strong>
            </div>
          ))}
        </div>
      </section>

      {state.chatOpen ? (
        <aside className="chat-panel" aria-label="Chat panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Local mock chat</p>
              <h2>Conversation</h2>
            </div>
            <span className="stage-badge">{AMADEUS_STAGE}</span>
          </div>

          <div className="message-list">
            {state.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onReplay={() => dispatch({ type: "replay", messageId: message.id })}
                onStop={() => dispatch({ type: "stop-speech" })}
              />
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <textarea
              aria-label="Message"
              value={state.input}
              onChange={(event) => dispatch({ type: "set-input", value: event.currentTarget.value })}
              placeholder="話しかける..."
              rows={3}
            />
            <div className="composer-actions">
              <button type="button" onClick={() => dispatch({ type: "stop-speech" })}>
                Stop speech
              </button>
              <button type="submit">Send</button>
            </div>
          </form>
        </aside>
      ) : null}
    </main>
  );
}

interface MessageBubbleProps {
  readonly message: ChatMessage;
  readonly onReplay: () => void;
  readonly onStop: () => void;
}

function MessageBubble({ message, onReplay, onStop }: MessageBubbleProps) {
  return (
    <article className={`message-bubble role-${message.role}`}>
      <div className="message-meta">
        <span>{message.role}</span>
        <span>{message.status}</span>
      </div>
      <p>{message.text}</p>
      {message.role === "assistant" ? (
        <div className="message-actions">
          <button type="button" onClick={onReplay}>
            Replay
          </button>
          <button type="button" onClick={onStop}>
            Stop
          </button>
        </div>
      ) : null}
    </article>
  );
}
