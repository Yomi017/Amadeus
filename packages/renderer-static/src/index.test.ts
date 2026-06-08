import { describe, expect, it } from "vitest";
import { buildFallbackSnapshot, createStaticCharacterRenderer, sanitizeRendererTextForTest } from "./index";

const idleState = {
  emotion: "soft" as const,
  speaking: false,
  mouthOpen: false,
  pose: "idle" as const
};

describe("static renderer", () => {
  it("builds a rights-clean fallback snapshot", () => {
    const snapshot = buildFallbackSnapshot({
      ...idleState,
      speaking: true,
      mouthOpen: true,
      pose: "replying"
    });

    expect(snapshot.asset).toMatchObject({
      id: "rights-clean-css-fallback",
      sourceKind: "css-fallback"
    });
    expect(snapshot.className).toContain("emotion-soft");
    expect(snapshot.className).toContain("pose-replying");
    expect(snapshot.speakingClassName).toBe("speech-speaking mouth-open");
  });

  it("returns fallback status and snapshot by default", async () => {
    const renderer = createStaticCharacterRenderer();

    await expect(renderer.status()).resolves.toMatchObject({
      id: "renderer",
      state: "mock"
    });

    const snapshot = renderer.snapshot(idleState);

    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.asset.safeDescription).toContain("fallback");
    }
  });

  it("blocks unsafe private asset paths without echoing them", async () => {
    const renderer = createStaticCharacterRenderer({
      mode: "private-image",
      privateImagePath: `/home/${"local-user"}/game/raw_extracted/private.png`
    });

    await expect(renderer.status()).resolves.toMatchObject({
      state: "blocked",
      detail: "Static renderer config contains unsafe private data"
    });

    const snapshot = renderer.snapshot(idleState);

    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) {
      expect(snapshot.error.message).not.toContain("private.png");
      expect(snapshot.fallback?.asset.sourceKind).toBe("css-fallback");
    }
  });

  it("keeps safe private image mode deferred", async () => {
    const renderer = createStaticCharacterRenderer({
      mode: "private-image",
      privateImagePath: "amadeus-private://character/main.png"
    });

    await expect(renderer.status()).resolves.toMatchObject({
      state: "blocked",
      detail: "Private character image path is configured but not loaded in Stage 5"
    });

    const snapshot = renderer.snapshot(idleState);

    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) {
      expect(snapshot.error.message).toBe("Private character image loading is deferred");
    }
  });

  it("rejects ordinary relative private image paths", async () => {
    const renderer = createStaticCharacterRenderer({
      mode: "private-image",
      privateImagePath: "private-assets/main.png"
    });

    await expect(renderer.status()).resolves.toMatchObject({
      state: "blocked",
      detail: "Private image mode only accepts amadeus-private references in Stage 5"
    });
  });

  it("requires privateImagePath for private image mode", async () => {
    const renderer = createStaticCharacterRenderer({ mode: "private-image" });

    await expect(renderer.status()).resolves.toMatchObject({
      state: "blocked",
      detail: "Private image mode requires a privateImagePath"
    });
  });

  it("sanitizes secret-like renderer text", () => {
    const result = sanitizeRendererTextForTest(`tok${"en"}=abc123 and /home/${"local-user"}/asset/main.png`);

    expect(result.safe).toBe(false);
    expect(result.text).toContain("[redacted]");
    expect(result.text).not.toContain("main.png");
  });
});
