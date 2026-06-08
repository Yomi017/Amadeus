import { useEffect, useRef, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AssistantReply, ChatMessage, TtsSynthesisResult } from "@amadeus/core";
import { buildSpeechJob, initialChatShellState, reduceChatShellState } from "./chat-shell";
import { ensurePetWindowMode } from "./pet-window-mode";
import { getPrivateCharacterImage } from "./private-character";
import { dragCurrentWindow } from "./window-drag";

const CHAT_HISTORY_KEY = "amadeus.chat.history.v1";

export function App() {
  const [state, dispatch] = useReducer(reduceChatShellState, initialChatShellState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const privateCharacter = getPrivateCharacterImage();
  const latestAssistantMessage = [...state.messages].reverse().find((message) => message.role === "assistant");

  useEffect(() => {
    ensurePetWindowMode();
  }, []);

  useEffect(() => {
    const restored = loadChatHistory();
    if (restored.length > 0) {
      dispatch({
        type: "restore-history",
        messages: restored
      });
    }
  }, []);

  useEffect(() => {
    saveChatHistory(state.messages);
  }, [state.messages]);

  useEffect(() => {
    return () => {
      stopAudio(audioRef.current);
    };
  }, []);

  async function sendMessage() {
    const text = state.input.trim();
    if (!text || state.busy) {
      return;
    }

    void unlockAudioPlayback();
    stopAudio(audioRef.current);
    audioRef.current = null;
    const now = new Date().toISOString();
    const ids = createMessageIds(now);
    dispatch({
      type: "submit-user",
      text,
      userId: ids.userId,
      assistantId: ids.assistantId,
      now
    });

    let assistantReceived = false;
    try {
      const reply = await invoke<AssistantReplyDto>("send_chat_message", {
        request: {
          text
        }
      });
      const normalizedReply = toAssistantReply(reply);
      dispatch({
        type: "assistant-received",
        messageId: ids.assistantId,
        reply: normalizedReply,
        detail: reply.statusDetail
      });
      assistantReceived = true;

      const speechText = normalizedReply.speechTextJa || normalizedReply.text;
      const ttsResult = await invoke<TtsResultDto>("synthesize_speech", {
        request: {
          id: `${ids.assistantId}-speech`,
          text: speechText,
          locale: "ja",
          emotion: normalizedReply.emotion ?? "soft",
          speed: 1,
          topP: 1,
          temperature: 1
        }
      });
      const result = toTtsResult(ttsResult);
      dispatch({
        type: "speech-queued",
        messageId: ids.assistantId,
        speechJob: buildSpeechJob(ids.assistantId, speechText, result)
      });
      playSpeech(result.audioUrl, ids.assistantId);
    } catch (error) {
      const message = safeErrorMessage(error);
      dispatch({
        type: assistantReceived ? "speech-failed" : "assistant-failed",
        messageId: ids.assistantId,
        error: message
      });
    }
  }

  function playSpeech(audioUrl: string, messageId: string) {
    stopAudio(audioRef.current);
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.addEventListener("play", () => {
      dispatch({
        type: "speech-started",
        messageId
      });
    });
    audio.addEventListener("ended", () => {
      dispatch({
        type: "speech-complete",
        messageId
      });
    });
    audio.addEventListener("error", () => {
      dispatch({
        type: "speech-failed",
        messageId,
        error: "Audio playback failed"
      });
    });
    audio.play().catch((error: unknown) => {
      dispatch({
        type: "speech-failed",
        messageId,
        error: safeErrorMessage(error)
      });
    });
  }

  return (
    <main className="amadeus-shell" data-tauri-drag-region="deep" onMouseDown={dragCurrentWindow}>
      <section className="pet-stage" aria-label="Desktop pet" data-tauri-drag-region="deep">
        <div
          className={`character-frame emotion-${state.character.emotion} ${
            privateCharacter.enabled ? "has-private-character" : "uses-fallback-character"
          } ${state.rendererClassName}`}
          data-tauri-drag-region="deep"
          onMouseDown={dragCurrentWindow}
        >
          {privateCharacter.enabled ? (
            <img
              className={`private-character ${state.character.speaking ? "is-speaking" : ""}`}
              src={privateCharacter.src}
              alt="Character"
              data-tauri-drag-region="deep"
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
        data-tauri-drag-region="false"
        onMouseDown={(event) => event.stopPropagation()}
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
          placeholder={state.busy ? "Thinking..." : "Type..."}
          disabled={state.busy}
        />
        <button type="submit" disabled={state.busy}>
          {state.busy ? "Wait" : "Send"}
        </button>
      </form>
    </main>
  );
}

interface ReplyBubbleProps {
  readonly message: ChatMessage;
}

function ReplyBubble({ message }: ReplyBubbleProps) {
  return (
    <article
      className="reply-bubble"
      data-tauri-drag-region="false"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p>{message.text}</p>
      <span>{statusLabel(message)}</span>
    </article>
  );
}

interface AssistantReplyDto {
  readonly id: string;
  readonly role: "assistant";
  readonly text: string;
  readonly speechTextJa?: string;
  readonly emotion?: AssistantReply["emotion"];
  readonly createdAt: string;
  readonly source: AssistantReply["source"];
  readonly statusDetail: string;
}

interface TtsResultDto {
  readonly id: string;
  readonly requestId: string;
  readonly source: TtsSynthesisResult["source"];
  readonly audioUrl: string;
  readonly format: TtsSynthesisResult["format"];
  readonly mimeType: TtsSynthesisResult["mimeType"];
  readonly createdAt: string;
  readonly durationMs?: number;
  readonly cached?: boolean;
}

function createMessageIds(seed: string): { readonly userId: string; readonly assistantId: string } {
  const suffix = `${Date.now().toString(36)}-${stableHash(seed).slice(0, 6)}`;
  return {
    userId: `user-${suffix}`,
    assistantId: `assistant-${suffix}`
  };
}

function toAssistantReply(reply: AssistantReplyDto): AssistantReply {
  return {
    id: reply.id,
    role: "assistant",
    text: reply.text,
    speechTextJa: reply.speechTextJa,
    emotion: reply.emotion,
    createdAt: reply.createdAt,
    source: reply.source
  };
}

function toTtsResult(result: TtsResultDto): TtsSynthesisResult {
  return {
    id: result.id,
    requestId: result.requestId,
    source: result.source,
    audioUrl: result.audioUrl,
    format: result.format,
    mimeType: result.mimeType,
    createdAt: result.createdAt,
    durationMs: result.durationMs,
    cached: result.cached
  };
}

function stopAudio(audio: HTMLAudioElement | null) {
  if (!audio) {
    return;
  }
  audio.pause();
  audio.currentTime = 0;
}

let audioUnlocked = false;

async function unlockAudioPlayback(): Promise<void> {
  if (audioUnlocked) {
    return;
  }

  const audio = new Audio(
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="
  );
  audio.volume = 0;
  try {
    await audio.play();
    audio.pause();
    audioUnlocked = true;
  } catch {
    audioUnlocked = false;
  }
}

function statusLabel(message: ChatMessage): string {
  if (message.status === "pending") {
    return "thinking";
  }
  if (message.speechState === "queued") {
    return "voice queued";
  }
  if (message.speechState === "speaking" || message.speechState === "mock-speaking") {
    return "speaking";
  }
  if (message.speechState === "failed") {
    return message.speechJob?.error ? `voice failed: ${message.speechJob.error}` : "voice failed";
  }
  return "ready";
}

function loadChatHistory(): readonly ChatMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item): ChatMessage[] => {
      if (!isStoredMessage(item)) {
        return [];
      }

      return [
        {
          id: item.id,
          role: item.role,
          text: item.text,
          speechTextJa: item.speechTextJa,
          status: "complete",
          createdAt: item.createdAt,
          speechState: item.speechState
        }
      ];
    });
  } catch {
    return [];
  }
}

function saveChatHistory(messages: readonly ChatMessage[]) {
  const stored = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-30)
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      speechTextJa: message.speechTextJa,
      status: "complete",
      createdAt: message.createdAt,
      speechState: message.speechState === "failed" ? "failed" : undefined
    }));

  try {
    window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(stored));
  } catch {
    return;
  }
}

function isStoredMessage(value: unknown): value is {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly speechTextJa?: string;
  readonly createdAt: string;
  readonly speechState?: "failed";
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.text === "string" &&
    (candidate.speechTextJa === undefined || typeof candidate.speechTextJa === "string") &&
    typeof candidate.createdAt === "string" &&
    (candidate.speechState === undefined || candidate.speechState === "failed")
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Amadeus request failed";
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
