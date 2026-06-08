import { useReducer } from "react";
import type { ChatMessage } from "@amadeus/core";
import { initialChatShellState, reduceChatShellState } from "./chat-shell";
import { getPrivateCharacterImage } from "./private-character";
import { dragCurrentWindow } from "./window-drag";

export function App() {
  const [state, dispatch] = useReducer(reduceChatShellState, initialChatShellState);
  const privateCharacter = getPrivateCharacterImage();
  const latestAssistantMessage = [...state.messages].reverse().find((message) => message.role === "assistant");

  function sendMessage() {
    dispatch({
      type: "send",
      text: state.input,
      now: new Date().toISOString()
    });
  }

  return (
    <main className="amadeus-shell" onPointerDown={dragCurrentWindow}>
      <section className="pet-stage" aria-label="Desktop pet">
        <div
          className={`character-frame emotion-${state.character.emotion} ${
            privateCharacter.enabled ? "has-private-character" : "uses-fallback-character"
          } ${state.rendererClassName}`}
          onPointerDown={dragCurrentWindow}
        >
          {privateCharacter.enabled ? (
            <img
              className={`private-character ${state.character.speaking ? "is-speaking" : ""}`}
              src={privateCharacter.src}
              alt="Character"
              draggable={false}
            />
          ) : (
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
          )}
          <div className="character-shadow" />
        </div>

        {latestAssistantMessage ? <ReplyBubble message={latestAssistantMessage} /> : null}
      </section>

      <form
        className="quick-composer"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <input
          aria-label="Message"
          value={state.input}
          onChange={(event) => dispatch({ type: "set-input", value: event.currentTarget.value })}
          placeholder="話しかける..."
        />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}

interface ReplyBubbleProps {
  readonly message: ChatMessage;
}

function ReplyBubble({ message }: ReplyBubbleProps) {
  return (
    <article className="reply-bubble" onPointerDown={(event) => event.stopPropagation()}>
      <p>{message.text}</p>
      <span>{message.speechState === "mock-speaking" ? "speaking..." : "ready"}</span>
    </article>
  );
}
