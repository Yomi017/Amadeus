import { describe, expect, it } from "vitest";
import { buildMockAssistantReply, buildMockSpeechJob, initialChatShellState, reduceChatShellState } from "./chat-shell";

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
    expect(next.activeSpeechJob?.result?.audioUrl).toContain("amadeus-mock://tts/");
    expect(next.rendererClassName).toContain("speech-speaking");
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
    expect(stopped.activeSpeechJob?.state).toBe("stopped");
    expect(stopped.rendererClassName).toContain("speech-idle");
  });

  it("replays assistant speech metadata locally", () => {
    const speaking = reduceChatShellState(initialChatShellState, {
      type: "send",
      text: "もう一度",
      now: "2026-06-08T00:00:00.000Z"
    });
    const replayed = reduceChatShellState(speaking, {
      type: "replay",
      messageId: speaking.messages.at(-1)?.id ?? "missing"
    });

    expect(replayed.character.speaking).toBe(true);
    expect(replayed.messages.at(-1)?.speechJob?.state).toBe("mock-speaking");
    expect(replayed.rendererClassName).toContain("speech-speaking");
  });

  it("keeps only one assistant speech job active across sends", () => {
    const first = reduceChatShellState(initialChatShellState, {
      type: "send",
      text: "最初",
      now: "2026-06-08T00:00:00.000Z"
    });
    const second = reduceChatShellState(first, {
      type: "send",
      text: "次",
      now: "2026-06-08T00:00:01.000Z"
    });

    const speakingMessages = second.messages.filter((message) => message.speechState === "mock-speaking");

    expect(speakingMessages).toHaveLength(1);
    expect(second.messages[2]?.speechState).toBe("stopped");
    expect(second.activeSpeechJob?.state).toBe("mock-speaking");
  });

  it("stops previous active speech when replaying another assistant message", () => {
    const first = reduceChatShellState(initialChatShellState, {
      type: "send",
      text: "最初",
      now: "2026-06-08T00:00:00.000Z"
    });
    const second = reduceChatShellState(first, {
      type: "send",
      text: "次",
      now: "2026-06-08T00:00:01.000Z"
    });
    const replayedFirst = reduceChatShellState(second, {
      type: "replay",
      messageId: second.messages[2]?.id ?? "missing"
    });

    const speakingMessages = replayedFirst.messages.filter((message) => message.speechState === "mock-speaking");

    expect(speakingMessages).toHaveLength(1);
    expect(replayedFirst.messages[2]?.speechState).toBe("mock-speaking");
    expect(replayedFirst.messages.at(-1)?.speechState).toBe("stopped");
  });

  it("builds mock speech job metadata without generating audio", () => {
    const job = buildMockSpeechJob("assistant-1", "hello", "2026-06-08T00:00:00.000Z");

    expect(job.state).toBe("mock-speaking");
    expect(job.result?.audioUrl).toBe("amadeus-mock://tts/assistant-1-speech.wav");
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
