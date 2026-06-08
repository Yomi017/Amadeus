import { describe, expect, it } from "vitest";
import { buildMockAssistantReply, initialChatShellState, reduceChatShellState } from "./chat-shell";

describe("chat shell reducer", () => {
  it("creates user and mock assistant messages without external services", () => {
    const next = reduceChatShellState(initialChatShellState, {
      type: "send",
      text: "今日の予定を教えて",
      now: "2026-06-08T00:00:00.000Z"
    });

    expect(next.messages).toHaveLength(3);
    expect(next.messages[1]?.role).toBe("user");
    expect(next.messages[2]?.role).toBe("assistant");
    expect(next.character.speaking).toBe(true);
    expect(next.input).toBe("");
  });

  it("stops mock speech locally", () => {
    const speaking = reduceChatShellState(initialChatShellState, {
      type: "send",
      text: "声を止めて",
      now: "2026-06-08T00:00:00.000Z"
    });
    const stopped = reduceChatShellState(speaking, { type: "stop-speech" });

    expect(stopped.character.speaking).toBe(false);
    expect(stopped.messages.at(-1)?.speechState).toBe("stopped");
  });

  it("returns a local fallback reply for empty text", () => {
    expect(buildMockAssistantReply(" ")).toContain("ここにいる");
  });

  it("does not send empty messages", () => {
    const next = reduceChatShellState(initialChatShellState, {
      type: "send",
      text: " ",
      now: "2026-06-08T00:00:00.000Z"
    });

    expect(next).toBe(initialChatShellState);
  });

  it("does not start speaking when replay target is missing", () => {
    const next = reduceChatShellState(initialChatShellState, {
      type: "replay",
      messageId: "missing"
    });

    expect(next).toBe(initialChatShellState);
  });
});
