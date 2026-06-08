import type { CharacterState, ChatMessage } from "@amadeus/core";

export interface ChatShellState {
  readonly messages: readonly ChatMessage[];
  readonly character: CharacterState;
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
  id: "system-stage-2",
  role: "system",
  text: "Amadeus v0 shell is running in local mock mode.",
  status: "complete",
  createdAt: "2026-06-08T00:00:00.000Z"
};

export const initialChatShellState: ChatShellState = {
  messages: [initialMessage],
  character: {
    emotion: "soft",
    speaking: false,
    mouthOpen: false,
    pose: "idle"
  },
  input: "",
  chatOpen: true
};

export function buildMockAssistantReply(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "ここにいる。用件を聞かせて。";
  }
  return `聞こえている。「${trimmed}」のことだな。今はまだ mock mode だが、そばにいる。`;
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
        createdAt: action.now,
        speechState: "mock-speaking"
      };
      return {
        ...state,
        input: "",
        messages: [...state.messages, userMessage, assistantMessage],
        character: {
          emotion: "focused",
          speaking: true,
          mouthOpen: true,
          pose: "replying"
        }
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
      if (!state.messages.some((message) => message.id === action.messageId && message.role === "assistant")) {
        return state;
      }
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId && message.role === "assistant"
            ? { ...message, speechState: "mock-speaking" }
            : message
        ),
        character: {
          emotion: "soft",
          speaking: true,
          mouthOpen: true,
          pose: "replying"
        }
      };
    case "stop-speech":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.speechState === "mock-speaking" ? { ...message, speechState: "stopped" } : message
        ),
        character: {
          emotion: "neutral",
          speaking: false,
          mouthOpen: false,
          pose: "idle"
        }
      };
    default:
      return state;
  }
}
