import type {
  CharacterEmotion,
  CharacterState,
  SafeAdapterResult,
  ServiceStatus,
  StaticCharacterRenderer,
  StaticRendererAssetDescriptor,
  StaticRendererConfig,
  StaticRendererMode,
  StaticRendererSnapshot
} from "@amadeus/core";

const DEFAULT_LABEL = "Static Renderer";
const REDACTED = "[redacted]";

export const RENDERER_STATIC_PACKAGE = "@amadeus/renderer-static";

export const FALLBACK_ASSET_DESCRIPTOR: StaticRendererAssetDescriptor = {
  id: "rights-clean-css-fallback",
  sourceKind: "css-fallback",
  label: "CSS fallback silhouette",
  safeDescription: "Rights-clean fallback character silhouette"
};

export function createStaticCharacterRenderer(config: StaticRendererConfig = {}): StaticCharacterRenderer {
  const mode: StaticRendererMode = config.mode ?? "fallback";
  const normalizedConfig: StaticRendererConfig = {
    mode,
    label: config.label,
    privateImagePath: config.privateImagePath
  };

  return {
    mode,
    config: normalizedConfig,
    async status(): Promise<ServiceStatus> {
      const configSafety = validateConfig(normalizedConfig);
      if (!configSafety.safe) {
        return createStatus("blocked", configSafety.message);
      }

      if (mode === "private-image") {
        return createStatus("blocked", "Private character image path is configured but not loaded in Stage 5");
      }

      return createStatus("mock", "Static fallback renderer ready");
    },
    snapshot(state: CharacterState): SafeAdapterResult<StaticRendererSnapshot> {
      const configSafety = validateConfig(normalizedConfig);
      if (!configSafety.safe) {
        return degraded(configSafety.message);
      }

      if (mode === "private-image") {
        return degraded("Private character image loading is deferred");
      }

      return {
        ok: true,
        status: createStatus("mock", "Static fallback renderer snapshot ready"),
        value: buildFallbackSnapshot(state)
      };
    }
  };
}

export function buildFallbackSnapshot(state: CharacterState): StaticRendererSnapshot {
  const emotion = normalizeEmotion(state.emotion);
  const pose = state.pose;
  const speaking = state.speaking ? "speaking" : "idle";

  return {
    asset: FALLBACK_ASSET_DESCRIPTOR,
    character: state,
    className: `renderer-static emotion-${emotion} pose-${pose}`,
    speakingClassName: `speech-${speaking} mouth-${state.mouthOpen ? "open" : "closed"}`
  };
}

export function sanitizeRendererTextForTest(text: string): { readonly safe: boolean; readonly text: string } {
  return sanitizeText(text);
}

function createStatus(state: ServiceStatus["state"], detail: string): ServiceStatus {
  return {
    id: "renderer",
    label: DEFAULT_LABEL,
    state,
    detail
  };
}

function degraded(message: string): SafeAdapterResult<StaticRendererSnapshot> {
  return {
    ok: false,
    degraded: true,
    status: createStatus("blocked", message),
    error: {
      kind: message.includes("unsafe private data") ? "unsafe-output" : "invalid-response",
      message,
      recoverable: false
    },
    fallback: buildFallbackSnapshot({
      emotion: "neutral",
      speaking: false,
      mouthOpen: false,
      pose: "idle"
    })
  };
}

function validateConfig(config: StaticRendererConfig): { readonly safe: true } | { readonly safe: false; readonly message: string } {
  for (const field of [config.label, config.privateImagePath]) {
    if (typeof field === "string" && !sanitizeText(field).safe) {
      return {
        safe: false,
        message: "Static renderer config contains unsafe private data"
      };
    }
  }

  if (config.mode === "private-image" && !config.privateImagePath) {
    return {
      safe: false,
      message: "Private image mode requires a privateImagePath"
    };
  }

  if (config.mode === "private-image" && config.privateImagePath && !config.privateImagePath.startsWith("amadeus-private://")) {
    return {
      safe: false,
      message: "Private image mode only accepts amadeus-private references in Stage 5"
    };
  }

  return { safe: true };
}

function normalizeEmotion(emotion: CharacterEmotion): CharacterEmotion {
  switch (emotion) {
    case "focused":
    case "happy":
    case "neutral":
    case "soft":
      return emotion;
  }
}

function sanitizeText(text: string): { readonly safe: boolean; readonly text: string } {
  let safe = true;
  let sanitized = text.slice(0, 500);

  for (const pattern of unsafePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      safe = false;
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, REDACTED);
    }
  }

  return {
    safe,
    text: sanitized
  };
}

const unsafePatterns: readonly RegExp[] = [
  /(?:\/home|\/Users)\/[^/\s"'`<>)]*\/[^\s"'`<>)]*(?:token|secret|cookie|credential|\.env|raw_extracted|\.png|\.jpg|\.jpeg|\.webp|\.psd|\.moc3|\.model3\.json)[^\s"'`<>)]*/gi,
  /\b[A-Z]:\\+Users\\+[^\\/\s"'`<>)]*\\+[^\s"'`<>)]*(?:token|secret|cookie|credential|\.env|raw_extracted|\.png|\.jpg|\.jpeg|\.webp|\.psd|\.moc3|\.model3\.json)[^\s"'`<>)]*/gi,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|cookie|credential|password)\s*[:=]\s*[^\s"'`<>]+/gi,
  /\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_]{12,}\b/g
];
