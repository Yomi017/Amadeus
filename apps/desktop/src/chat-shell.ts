import type { CharacterState, ChatMessage, SpeechJob } from "@amadeus/core";
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
}

export type ChatShellAction =
  | { readonly type: "set-input"; readonly value: string }
  | { readonly type: "toggle-chat" }
  | { readonly type: "send"; readonly text: string; readonly now: string }
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
  chatOpen: true
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

export function buildRendererClassName(state: CharacterState): string {
  const snapshot = buildFallbackSnapshot(state);
  return `${snapshot.className} ${snapshot.speakingClassName}`;
}

export function stopActiveSpeechMessages(messages: readonly ChatMessage[], rendererClassName: string): readonly ChatMessage[] {
  return messages.map((message) =>
    message.speechState === "mock-speaking"
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
        messages: stopActiveSpeechMessages(state.messages, idleClassName),
        character: idleCharacter,
        rendererClassName: idleClassName,
        activeSpeechJob: state.activeSpeechJob ? { ...state.activeSpeechJob, state: "stopped" } : undefined
      };
    default:
      return state;
  }
}
