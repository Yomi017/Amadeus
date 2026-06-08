import { describe, expect, it } from "vitest";
import { buildMockAssistantReply, createHermesAdapter, sanitizeHermesTextForTest } from "./index";

const request = {
  id: "turn-1",
  createdAt: "2026-06-08T00:00:00.000Z",
  messages: [{ role: "user" as const, text: "今日の予定を教えて" }]
};

describe("Hermes adapter", () => {
  it("returns deterministic mock status and replies by default", async () => {
    const adapter = createHermesAdapter();

    await expect(adapter.status()).resolves.toMatchObject({ state: "mock" });
    await expect(adapter.request(request)).resolves.toMatchObject({
      ok: true,
      value: {
        id: "hermes-reply-18046e8c",
        source: "mock"
      }
    });
  });

  it("keeps real mode degraded when no transport is injected", async () => {
    const adapter = createHermesAdapter({ mode: "real" });

    await expect(adapter.status()).resolves.toMatchObject({ state: "offline" });
    await expect(adapter.request(request)).resolves.toMatchObject({
      ok: false,
      error: { kind: "offline" }
    });
  });

  it("uses an injected transport without discovering private Hermes files", async () => {
    const adapter = createHermesAdapter(
      { mode: "real" },
      {
        status: () => ({ available: true, detail: "ready" }),
        request: () => ({ text: "了解した。", id: "reply-1", createdAt: "2026-06-08T00:00:01.000Z" })
      }
    );

    await expect(adapter.status()).resolves.toMatchObject({ state: "available", detail: "ready" });
    await expect(adapter.request(request)).resolves.toMatchObject({
      ok: true,
      value: { text: "了解した。", source: "hermes" }
    });
  });

  it("rejects unsafe transport output before returning it to callers", async () => {
    const adapter = createHermesAdapter(
      { mode: "real" },
      {
        status: () => ({ available: true, detail: "ready" }),
        request: () => ({ text: `read /home/${"local-user"}/.hermes/private-state.json` })
      }
    );

    const result = await adapter.request(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsafe-output");
      expect(result.error.message).not.toContain(".hermes");
    }
  });

  it("rejects common cross-platform private paths and bearer secrets", async () => {
    const samples = [
      `/Users/${"local-user"}/.hermes/state.json`,
      `C:\\Users\\${"local-user"}\\.hermes\\state.json`,
      `Authorization: Bea${"rer"} abcdefgh12345678`,
      `sk-${"a".repeat(20)}`
    ];

    for (const sample of samples) {
      const adapter = createHermesAdapter(
        { mode: "real" },
        {
          status: () => ({ available: true, detail: "ready" }),
          request: () => ({ text: sample })
        }
      );

      const result = await adapter.request(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("unsafe-output");
      }
    }
  });

  it("degrades invalid transport status shapes", async () => {
    const adapter = createHermesAdapter(
      { mode: "real" },
      {
        status: () => ({ available: "false", detail: "ready" }) as never,
        request: () => ({ text: "了解した。" })
      }
    );

    await expect(adapter.status()).resolves.toMatchObject({
      state: "degraded",
      detail: "Transport returned an invalid Hermes status"
    });
  });

  it("sanitizes known secret-like text for diagnostics", () => {
    const result = sanitizeHermesTextForTest(`tok${"en"}=abc123 and /home/${"local-user"}/.hermes/state`);

    expect(result.safe).toBe(false);
    expect(result.text).toContain("[redacted]");
    expect(result.text).not.toContain(".hermes/state");
  });

  it("builds a mock reply without leaking unbounded user text", () => {
    const reply = buildMockAssistantReply({
      id: "long",
      messages: [{ role: "user", text: "x".repeat(500) }]
    });

    expect(reply.text.length).toBeLessThan(360);
  });

  it("does not echo unsafe user text in mock replies", () => {
    const reply = buildMockAssistantReply({
      id: "unsafe-user-text",
      messages: [{ role: "user", text: `open /home/${"local-user"}/.hermes/state` }]
    });

    expect(reply.text).not.toContain(".hermes");
    expect(reply.text).not.toContain("/home/");
  });
});
