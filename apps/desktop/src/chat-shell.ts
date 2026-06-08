import type { AssistantReply, CharacterEmotion, CharacterState, ChatMessage, SpeechJob, TtsSynthesisResult } from "@amadeus/core";
import { buildMockAssistantReply as buildHermesMockAssistantReply } from "@amadeus/hermes-adapter";
import { buildMockResult as buildMockTtsResult } from "@amadeus/tts-gpt-sovits";
import { buildFallbackSnapshot } from "@amadeus/renderer-static";

export interface ChatShellState {
  readonly messages: readonly ChatMessage[];
  readonly character: CharacterState;
  readonly rendererClassName: string;
  readonly activeSpeechJob?: SpeechJob;
  readonly input: string;
  readonly chatOpen: boolean;
  readonly busy: boolean;
  readonly serviceDetail?: string;
}

export type ChatShellAction =
  | { readonly type: "set-input"; readonly value: string }
  | { readonly type: "toggle-chat" }
  | { readonly type: "restore-history"; readonly messages: readonly ChatMessage[] }
  | { readonly type: "send"; readonly text: string; readonly now: string }
  | { readonly type: "submit-user"; readonly text: string; readonly userId: string; readonly assistantId: string; readonly now: string }
  | { readonly type: "assistant-received"; readonly messageId: string; readonly reply: AssistantReply; readonly detail?: string }
  | { readonly type: "assistant-failed"; readonly messageId: string; readonly error: string }
  | { readonly type: "speech-queued"; readonly messageId: string; readonly speechJob: SpeechJob }
  | { readonly type: "speech-started"; readonly messageId: string }
  | { readonly type: "speech-complete"; readonly messageId: string }
  | { readonly type: "speech-failed"; readonly messageId: string; readonly error: string }
  | { readonly type: "cancel"; readonly messageId: string }
  | { readonly type: "replay"; readonly messageId: string }
  | { readonly type: "stop-speech" };

const initialMessage: ChatMessage = {
  id: "system-stage-6",
  role: "system",
  text: "Amadeus v0 shell is running the local mock chat, speech job, and static renderer flow.",
  status: "complete",
  createdAt: "2026-06-08T00:00:00.000Z"
};

const initialCharacter: CharacterState = {
  emotion: "soft",
  speaking: false,
  mouthOpen: false,
  pose: "idle"
};

export const initialChatShellState: ChatShellState = {
  messages: [initialMessage],
  character: initialCharacter,
  rendererClassName: buildRendererClassName(initialCharacter),
  input: "",
  chatOpen: false,
  busy: false
};

export function buildMockAssistantReply(text: string): string {
  return buildHermesMockAssistantReply({
    id: "desktop-mock-chat",
    messages: [
      {
        role: "user",
        text
      }
    ]
  }).text;
}

export function buildMockSpeechJob(messageId: string, text: string, now: string): SpeechJob {
  const result = buildMockTtsResult({
    id: `${messageId}-speech`,
    text,
    locale: "ja",
    createdAt: now
  });

  return {
    id: result.id,
    state: "mock-speaking",
    text,
    result
  };
}

export function buildSpeechJob(messageId: string, text: string, result: TtsSynthesisResult): SpeechJob {
  return {
    id: result.id || `${messageId}-speech`,
    state: "queued",
    text,
    result
  };
}

export function buildRendererClassName(state: CharacterState): string {
  const snapshot = buildFallbackSnapshot(state);
  return `${snapshot.className} ${snapshot.speakingClassName}`;
}

export function isActiveSpeechState(state: ChatMessage["speechState"]): boolean {
  return state === "mock-speaking" || state === "queued" || state === "speaking";
}

export function stopActiveSpeechMessages(messages: readonly ChatMessage[], rendererClassName: string): readonly ChatMessage[] {
  return messages.map((message) =>
    isActiveSpeechState(message.speechState)
      ? {
          ...message,
          speechState: "stopped",
          speechJob: message.speechJob ? { ...message.speechJob, state: "stopped" } : undefined,
          rendererClassName
        }
      : message
  );
}

export function reduceChatShellState(state: ChatShellState, action: ChatShellAction): ChatShellState {
  switch (action.type) {
    case "set-input":
      return { ...state, input: action.value };
    case "toggle-chat":
      return { ...state, chatOpen: !state.chatOpen };
    case "restore-history": {
      const restoredMessages: ChatMessage[] = action.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message): ChatMessage => {
          const speechState = message.speechState === "failed" ? message.speechState : undefined;
          return {
            id: message.id,
            role: message.role,
            text: message.text,
            speechTextJa: message.speechTextJa,
            shouldSpeak: message.shouldSpeak,
            status: message.status === "pending" ? "complete" : message.status,
            createdAt: message.createdAt,
            speechState,
            rendererClassName: message.rendererClassName
          };
        })
        .slice(-30);

      return {
        ...state,
        messages: restoredMessages.length > 0 ? [initialMessage, ...restoredMessages] : state.messages,
        busy: false,
        activeSpeechJob: undefined
      };
    }
    case "send": {
      const text = action.text.trim();
      if (!text) {
        return state;
      }
      const userMessage: ChatMessage = {
        id: `user-${state.messages.length + 1}`,
        role: "user",
        text,
        status: "complete",
        createdAt: action.now
      };
      const assistantMessage: ChatMessage = {
        id: `assistant-${state.messages.length + 2}`,
        role: "assistant",
        text: buildMockAssistantReply(text),
        status: "complete",
        createdAt: action.now
      };
      const speechJob = buildMockSpeechJob(assistantMessage.id, assistantMessage.text, action.now);
      const replyingCharacter: CharacterState = {
        emotion: "focused",
        speaking: true,
        mouthOpen: true,
        pose: "replying"
      };
      const rendererClassName = buildRendererClassName(replyingCharacter);
      const stoppedMessages = stopActiveSpeechMessages(state.messages, rendererClassName);
      return {
        ...state,
        input: "",
        busy: false,
        messages: [
          ...stoppedMessages,
          userMessage,
          {
            ...assistantMessage,
            speechState: speechJob.state,
            speechJob,
            rendererClassName
          }
        ],
        character: replyingCharacter,
        rendererClassName,
        activeSpeechJob: speechJob
      };
    }
    case "submit-user": {
      const text = action.text.trim();
      if (!text) {
        return state;
      }

      const waitingCharacter: CharacterState = {
        emotion: "focused",
        speaking: false,
        mouthOpen: false,
        pose: "listening"
      };
      const rendererClassName = buildRendererClassName(waitingCharacter);
      const stoppedMessages = stopActiveSpeechMessages(state.messages, rendererClassName);
      const userMessage: ChatMessage = {
        id: action.userId,
        role: "user",
        text,
        status: "complete",
        createdAt: action.now
      };
      const assistantMessage: ChatMessage = {
        id: action.assistantId,
        role: "assistant",
        text: "...",
        status: "pending",
        createdAt: action.now
      };

      return {
        ...state,
        input: "",
        busy: true,
        serviceDetail: undefined,
        messages: [...stoppedMessages, userMessage, assistantMessage],
        character: waitingCharacter,
        rendererClassName,
        activeSpeechJob: state.activeSpeechJob ? { ...state.activeSpeechJob, state: "stopped" } : undefined
      };
    }
    case "assistant-received": {
      const emotion = normalizeEmotion(action.reply.emotion);
      const receivedCharacter: CharacterState = {
        emotion,
        speaking: false,
        mouthOpen: false,
        pose: "replying"
      };
      const rendererClassName = buildRendererClassName(receivedCharacter);

      return {
        ...state,
        busy: false,
        serviceDetail: action.detail,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                text: action.reply.text,
                speechTextJa: action.reply.speechTextJa,
                shouldSpeak: action.reply.shouldSpeak,
                status: "complete",
                createdAt: action.reply.createdAt,
                rendererClassName
              }
            : message
        ),
        character: receivedCharacter,
        rendererClassName
      };
    }
    case "assistant-failed": {
      const idleCharacter: CharacterState = {
        emotion: "neutral",
        speaking: false,
        mouthOpen: false,
        pose: "idle"
      };
      const rendererClassName = buildRendererClassName(idleCharacter);

      return {
        ...state,
        busy: false,
        serviceDetail: action.error,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                text: "Hermes is offline. Try again after the local service is ready.",
                status: "complete",
                rendererClassName
              }
            : message
        ),
        character: idleCharacter,
        rendererClassName
      };
    }
    case "speech-queued": {
      const queuedCharacter: CharacterState = {
        emotion: "soft",
        speaking: false,
        mouthOpen: false,
        pose: "replying"
      };
      const rendererClassName = buildRendererClassName(queuedCharacter);

      return {
        ...state,
        serviceDetail: undefined,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                speechState: "queued",
                speechJob: action.speechJob,
                rendererClassName
              }
            : isActiveSpeechState(message.speechState)
              ? {
                  ...message,
                  speechState: "stopped",
                  speechJob: message.speechJob ? { ...message.speechJob, state: "stopped" } : undefined,
                  rendererClassName
                }
              : message
        ),
        character: queuedCharacter,
        rendererClassName,
        activeSpeechJob: action.speechJob
      };
    }
    case "speech-started": {
      const speakingCharacter: CharacterState = {
        emotion: "focused",
        speaking: true,
        mouthOpen: true,
        pose: "replying"
      };
      const rendererClassName = buildRendererClassName(speakingCharacter);

      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                speechState: "speaking",
                speechJob: message.speechJob ? { ...message.speechJob, state: "speaking" } : undefined,
                rendererClassName
              }
            : message
        ),
        character: speakingCharacter,
        rendererClassName,
        activeSpeechJob: state.activeSpeechJob ? { ...state.activeSpeechJob, state: "speaking" } : undefined
      };
    }
    case "speech-complete": {
      const idleCharacter: CharacterState = {
        emotion: "soft",
        speaking: false,
        mouthOpen: false,
        pose: "idle"
      };
      const rendererClassName = buildRendererClassName(idleCharacter);

      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                speechState: "complete",
                speechJob: message.speechJob ? { ...message.speechJob, state: "complete" } : undefined,
                rendererClassName
              }
            : message
        ),
        character: idleCharacter,
        rendererClassName,
        activeSpeechJob: state.activeSpeechJob ? { ...state.activeSpeechJob, state: "complete" } : undefined
      };
    }
    case "speech-failed": {
      const idleCharacter: CharacterState = {
        emotion: "neutral",
        speaking: false,
        mouthOpen: false,
        pose: "idle"
      };
      const rendererClassName = buildRendererClassName(idleCharacter);

      return {
        ...state,
        serviceDetail: action.error,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                speechState: "failed",
                speechJob: message.speechJob
                  ? { ...message.speechJob, state: "failed", error: action.error }
                  : {
                      id: `${action.messageId}-speech-failed`,
                      state: "failed",
                      text: "",
                      error: action.error
                    },
                rendererClassName
              }
            : message
        ),
        character: idleCharacter,
        rendererClassName,
        activeSpeechJob: state.activeSpeechJob ? { ...state.activeSpeechJob, state: "failed" } : undefined
      };
    }
    case "cancel":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.status === "pending"
            ? { ...message, status: "cancelled" }
            : message
        )
      };
    case "replay":
      const replayMessage = state.messages.find((message) => message.id === action.messageId && message.role === "assistant");
      if (!replayMessage) {
        return state;
      }
      const replayCharacter: CharacterState = {
        emotion: "soft",
        speaking: true,
        mouthOpen: true,
        pose: "replying"
      };
      const replayClassName = buildRendererClassName(replayCharacter);
      const replaySpeechJob: SpeechJob = replayMessage.speechJob
        ? { ...replayMessage.speechJob, state: "mock-speaking" }
        : buildMockSpeechJob(replayMessage.id, replayMessage.text, replayMessage.createdAt);
      const stoppedMessages = stopActiveSpeechMessages(state.messages, replayClassName);
      return {
        ...state,
        messages: stoppedMessages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? {
                ...message,
                speechState: "mock-speaking",
                speechJob: replaySpeechJob,
                rendererClassName: replayClassName
              }
            : message
        ),
        character: replayCharacter,
        rendererClassName: replayClassName,
        activeSpeechJob: replaySpeechJob
      };
    case "stop-speech":
      const idleCharacter: CharacterState = {
        emotion: "neutral",
        speaking: false,
        mouthOpen: false,
        pose: "idle"
      };
      const idleClassName = buildRendererClassName(idleCharacter);
      return {
        ...state,
        busy: false,
        messages: stopActiveSpeechMessages(state.messages, idleClassName),
        character: idleCharacter,
        rendererClassName: idleClassName,
        activeSpeechJob: state.activeSpeechJob ? { ...state.activeSpeechJob, state: "stopped" } : undefined
      };
    default:
      return state;
  }
}

function normalizeEmotion(value: CharacterEmotion | undefined): CharacterEmotion {
  if (value === "happy" || value === "focused" || value === "soft" || value === "neutral") {
    return value;
  }

  return "soft";
}
