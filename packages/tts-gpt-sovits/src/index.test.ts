import { describe, expect, it } from "vitest";
import {
  buildMockResult,
  createGptSovitsHttpTransport,
  createGptSovitsTtsProvider,
  sanitizeGptSovitsTextForTest,
  type FetchLike
} from "./index";

const request = {
  id: "tts-1",
  text: "おはよう。今日も一緒に行こう。",
  locale: "ja",
  createdAt: "2026-06-08T00:00:00.000Z"
};

describe("GPT-SoVITS TTS provider", () => {
  it("returns offline-safe mock status and audio metadata by default", async () => {
    const provider = createGptSovitsTtsProvider();

    await expect(provider.status()).resolves.toMatchObject({
      id: "tts",
      state: "mock"
    });

    const result = await provider.synthesize(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: "mock-tts-1",
        requestId: "tts-1",
        source: "mock",
        format: "wav",
        mimeType: "audio/wav",
        audioUrl: "amadeus-mock://tts/tts-1.wav"
      });
    }
  });

  it("keeps http mode offline when no endpoint or transport is configured", async () => {
    const provider = createGptSovitsTtsProvider({ mode: "http" });

    await expect(provider.status()).resolves.toMatchObject({
      state: "offline"
    });

    const result = await provider.synthesize(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("offline");
    }
  });

  it("uses an injected transport without reading model paths or assets", async () => {
    const provider = createGptSovitsTtsProvider(
      { mode: "http" },
      {
        status: () => ({ available: true, detail: "ready" }),
        synthesize: (input) => ({
          id: "tts-output",
          requestId: input.id,
          audioUrl: "file:///tmp/amadeus-tts-cache/tts-output.wav",
          format: "wav",
          mimeType: "audio/wav",
          durationMs: 25
        })
      }
    );

    await expect(provider.status()).resolves.toMatchObject({
      state: "available",
      detail: "ready"
    });

    const result = await provider.synthesize(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe("gpt-sovits");
      expect(result.value.audioUrl).toBe("file:///tmp/amadeus-tts-cache/tts-output.wav");
      expect(result.value.durationMs).toBe(25);
    }
  });

  it("blocks model path and reference audio config keys", async () => {
    const provider = createGptSovitsTtsProvider({
      mode: "http",
      endpoint: "http://127.0.0.1:48162",
      modelPath: `/home/${"local-user"}/voice/model.pth`
    } as never);

    await expect(provider.status()).resolves.toMatchObject({
      state: "blocked"
    });

    const result = await provider.synthesize(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain(".pth");
    }
  });

  it("blocks private paths hidden in unknown config fields", async () => {
    const provider = createGptSovitsTtsProvider({
      mode: "http",
      endpoint: "http://127.0.0.1:48162",
      custom: {
        gpt_path: `/home/${"local-user"}/voice/model.ckpt`
      }
    } as never);

    await expect(provider.status()).resolves.toMatchObject({
      state: "blocked"
    });
  });

  it("blocks non-loopback HTTP endpoints", async () => {
    const provider = createGptSovitsTtsProvider({
      mode: "http",
      endpoint: "https://example.com/tts"
    });

    await expect(provider.status()).resolves.toMatchObject({
      state: "blocked",
      detail: "GPT-SoVITS endpoint must be a local loopback HTTP URL"
    });
  });

  it("blocks long text, private paths, and secret-like request text", async () => {
    const samples = [
      "x".repeat(501),
      `/Users/${"local-user"}/voice/ref.wav`,
      `C:\\Users\\${"local-user"}\\voice\\model.ckpt`,
      `Authorization: Bea${"rer"} abcdefgh12345678`,
      `sk-${"a".repeat(20)}`
    ];

    for (const text of samples) {
      const provider = createGptSovitsTtsProvider();
      const result = await provider.synthesize({ ...request, text });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("invalid-response");
      }
    }
  });

  it("checks the configured /status endpoint through injected fetch", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (input) => {
      calls.push(input);

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ available: true, detail: "healthy" })
      };
    };

    const provider = createGptSovitsTtsProvider(
      { mode: "http", endpoint: "http://127.0.0.1:48162" },
      createGptSovitsHttpTransport(fetcher)
    );

    await expect(provider.status()).resolves.toMatchObject({
      state: "available",
      detail: "healthy"
    });
    expect(calls).toEqual(["http://127.0.0.1:48162/status"]);
  });

  it("posts a minimal /synthesize request and reads JSON audio metadata", async () => {
    const calls: Array<{ readonly input: string; readonly body: unknown }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({
        input,
        body: JSON.parse(init?.body ?? "{}")
      });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          id: "tts-output",
          requestId: "tts-1",
          audioUrl: "file:///tmp/amadeus-tts-cache/tts-output.wav",
          format: "wav",
          mimeType: "audio/wav",
          durationMs: 42,
          cached: false
        })
      };
    };

    const provider = createGptSovitsTtsProvider(
      { mode: "http", endpoint: "http://127.0.0.1:48162" },
      createGptSovitsHttpTransport(fetcher)
    );

    const result = await provider.synthesize(request);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      input: "http://127.0.0.1:48162/synthesize",
      body: {
        id: "tts-1",
        text: request.text,
        locale: "ja",
        voice: undefined,
        emotion: undefined,
        speed: undefined,
        topP: undefined,
        temperature: undefined,
        metadata: undefined
      }
    });
    if (result.ok) {
      expect(result.value.audioUrl).toBe("file:///tmp/amadeus-tts-cache/tts-output.wav");
      expect(result.value.durationMs).toBe(42);
    }
  });

  it("degrades unsafe service result metadata", async () => {
    const provider = createGptSovitsTtsProvider(
      { mode: "http" },
      {
        status: () => ({ available: true, detail: "ready" }),
        synthesize: () => ({
          id: "tts-output",
          requestId: "tts-1",
          audioUrl: `file:///home/${"local-user"}/voice/private.${"wav"}`,
          format: "wav",
          mimeType: "audio/wav"
        })
      }
    );

    const result = await provider.synthesize(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsafe-output");
      expect(result.error.message).not.toContain("private.wav");
    }
  });

  it("sanitizes unsafe diagnostic text", () => {
    const result = sanitizeGptSovitsTextForTest(`tok${"en"}=abc123 and /home/${"local-user"}/voice/ref.wav`);

    expect(result.safe).toBe(false);
    expect(result.text).toContain("[redacted]");
    expect(result.text).not.toContain("ref.wav");
  });

  it("builds mock audio metadata without needing private assets", () => {
    const result = buildMockResult({ id: "mock", text: "hello" });

    expect(result.audioUrl).toBe("amadeus-mock://tts/mock.wav");
    expect(result.source).toBe("mock");
  });
});
