import type {
  SafeAdapterErrorKind,
  SafeAdapterResult,
  ServiceStatus,
  TtsProvider,
  TtsProviderConfig,
  TtsProviderMode,
  TtsSynthesisRequest,
  TtsSynthesisResult
} from "@amadeus/core";

export type GptSovitsTtsMode = TtsProviderMode;

export interface GptSovitsTtsConfig extends TtsProviderConfig {
  readonly statusPath?: string;
  readonly synthesizePath?: string;
}

export interface GptSovitsServiceStatus {
  readonly available: boolean;
  readonly detail?: string;
}

export interface GptSovitsServiceResult {
  readonly id: string;
  readonly requestId: string;
  readonly audioUrl: string;
  readonly format?: "wav";
  readonly mimeType?: "audio/wav";
  readonly createdAt?: string;
  readonly durationMs?: number;
  readonly cached?: boolean;
}

export interface GptSovitsTtsTransport {
  readonly status: (config: NormalizedGptSovitsTtsConfig) => Promise<GptSovitsServiceStatus> | GptSovitsServiceStatus;
  readonly synthesize: (
    request: TtsSynthesisRequest,
    config: NormalizedGptSovitsTtsConfig
  ) => Promise<GptSovitsServiceResult> | GptSovitsServiceResult;
}

export type NormalizedGptSovitsTtsConfig = Required<
  Pick<GptSovitsTtsConfig, "label" | "mode" | "statusPath" | "synthesizePath" | "timeoutMs">
> &
  Omit<GptSovitsTtsConfig, "label" | "mode" | "statusPath" | "synthesizePath" | "timeoutMs">;

export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly json?: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  }
) => Promise<FetchLikeResponse>;

const DEFAULT_LABEL = "GPT-SoVITS";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STATUS_PATH = "/status";
const DEFAULT_SYNTHESIZE_PATH = "/synthesize";
const MOCK_CREATED_AT = "2026-06-08T00:00:00.000Z";
const MAX_TEXT_LENGTH = 500;
const REDACTED = "[redacted]";
const UNSAFE_DETAIL = "GPT-SoVITS service returned unsafe private data";

export function createGptSovitsTtsProvider(
  config: GptSovitsTtsConfig = {},
  transport?: GptSovitsTtsTransport
): TtsProvider {
  const rawConfigSafety = validateRawConfig(config);
  const normalizedConfig = normalizeConfig(config);
  const resolvedTransport = transport ?? createHttpTransport(normalizedConfig);

  return {
    mode: normalizedConfig.mode,
    config: normalizedConfig,
    async status(): Promise<ServiceStatus> {
      if (!rawConfigSafety.safe) {
        return createStatus("blocked", rawConfigSafety.message);
      }

      const configSafety = validateConfig(normalizedConfig);
      if (!configSafety.safe) {
        return createStatus("blocked", configSafety.message);
      }

      if (normalizedConfig.mode === "mock") {
        return createStatus("mock", "Mock GPT-SoVITS provider ready");
      }

      if (!resolvedTransport) {
        return createStatus("offline", "GPT-SoVITS endpoint is not configured");
      }

      try {
        const serviceStatus = await resolvedTransport.status(normalizedConfig);
        if (!isServiceStatus(serviceStatus)) {
          return createStatus("degraded", "GPT-SoVITS service returned an invalid status");
        }

        const sanitizedDetail = sanitizeText(serviceStatus.detail ?? "");
        if (!sanitizedDetail.safe) {
          return createStatus("degraded", UNSAFE_DETAIL);
        }

        return createStatus(
          serviceStatus.available ? "available" : "degraded",
          sanitizedDetail.text || (serviceStatus.available ? "GPT-SoVITS service ready" : "GPT-SoVITS service unavailable")
        );
      } catch (error) {
        return createStatus("degraded", sanitizeThrowable(error, "GPT-SoVITS status check failed"));
      }
    },
    async synthesize(request: TtsSynthesisRequest): Promise<SafeAdapterResult<TtsSynthesisResult>> {
      if (!rawConfigSafety.safe) {
        return degraded("invalid-response", rawConfigSafety.message, "blocked");
      }

      const requestSafety = validateRequest(request);
      if (!requestSafety.safe) {
        return degraded("invalid-response", requestSafety.message, "blocked");
      }

      const configSafety = validateConfig(normalizedConfig);
      if (!configSafety.safe) {
        return degraded("invalid-response", configSafety.message, "blocked");
      }

      const text = request.text.trim();
      if (!text) {
        return degraded("invalid-response", "TTS text is empty");
      }

      if (normalizedConfig.mode === "mock") {
        return ok(createStatus("mock", "Mock GPT-SoVITS synthesis result ready"), buildMockResult(request));
      }

      if (!resolvedTransport) {
        return degraded("offline", "GPT-SoVITS endpoint is not configured", "offline");
      }

      try {
        const serviceResult = await resolvedTransport.synthesize(
          {
            ...request,
            text
          },
          normalizedConfig
        );

        const parsed = parseServiceResult(serviceResult, request);
        if (!parsed.ok) {
          return degraded(parsed.kind, parsed.message);
        }

        return ok(createStatus("available", "GPT-SoVITS synthesis result received"), parsed.value);
      } catch (error) {
        return degraded("transport-error", sanitizeThrowable(error, "GPT-SoVITS synthesis failed"));
      }
    }
  };
}

export function createGptSovitsHttpTransport(fetchImpl?: FetchLike): GptSovitsTtsTransport {
  return {
    async status(config: NormalizedGptSovitsTtsConfig): Promise<GptSovitsServiceStatus> {
      if (!config.endpoint) {
        return {
          available: false,
          detail: "GPT-SoVITS endpoint is not configured"
        };
      }

      const fetcher = fetchImpl ?? globalThis.fetch;
      if (!fetcher) {
        return {
          available: false,
          detail: "Fetch API is not available for GPT-SoVITS HTTP transport"
        };
      }

      const response = await fetchWithTimeout(
        fetcher as FetchLike,
        joinUrl(config.endpoint, config.statusPath),
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        },
        config.timeoutMs
      );

      if (!response.ok) {
        return {
          available: false,
          detail: `GPT-SoVITS HTTP ${response.status}: ${sanitizeThrowable(response.statusText, "request failed")}`
        };
      }

      const json = await readJson(response);
      if (isServiceStatus(json)) {
        return json;
      }

      return {
        available: true,
        detail: "GPT-SoVITS status endpoint reached"
      };
    },
    async synthesize(request: TtsSynthesisRequest, config: NormalizedGptSovitsTtsConfig): Promise<GptSovitsServiceResult> {
      if (!config.endpoint) {
        throw new GptSovitsHttpError("GPT-SoVITS endpoint is not configured");
      }

      const fetcher = fetchImpl ?? globalThis.fetch;
      if (!fetcher) {
        throw new GptSovitsHttpError("Fetch API is not available for GPT-SoVITS HTTP transport");
      }

      const response = await fetchWithTimeout(
        fetcher as FetchLike,
        joinUrl(config.endpoint, config.synthesizePath),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(toWireRequest(request))
        },
        config.timeoutMs
      );

      if (!response.ok) {
        throw new GptSovitsHttpError(`GPT-SoVITS HTTP ${response.status}: ${sanitizeThrowable(response.statusText, "request failed")}`);
      }

      const json = await readJson(response);
      if (!isServiceResult(json)) {
        throw new GptSovitsHttpError("GPT-SoVITS service returned an invalid synthesis result");
      }

      return json;
    }
  };
}

export function buildMockResult(request: TtsSynthesisRequest): TtsSynthesisResult {
  return {
    id: `mock-${request.id}`,
    requestId: request.id,
    source: "mock",
    audioUrl: `amadeus-mock://tts/${encodeURIComponent(request.id)}.wav`,
    format: "wav",
    mimeType: "audio/wav",
    createdAt: request.createdAt ?? MOCK_CREATED_AT,
    durationMs: 0,
    cached: false
  };
}

export function sanitizeGptSovitsTextForTest(text: string): { readonly safe: boolean; readonly text: string } {
  return sanitizeText(text);
}

function normalizeConfig(config: GptSovitsTtsConfig): NormalizedGptSovitsTtsConfig {
  return {
    mode: config.mode ?? "mock",
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    statusPath: config.statusPath ?? DEFAULT_STATUS_PATH,
    synthesizePath: config.synthesizePath ?? DEFAULT_SYNTHESIZE_PATH,
    label: config.label ?? DEFAULT_LABEL
  };
}

function createHttpTransport(config: NormalizedGptSovitsTtsConfig): GptSovitsTtsTransport | undefined {
  if (config.mode !== "http" || !config.endpoint) {
    return undefined;
  }

  return createGptSovitsHttpTransport();
}

function createStatus(state: ServiceStatus["state"], detail: string): ServiceStatus {
  return {
    id: "tts",
    label: DEFAULT_LABEL,
    state,
    detail
  };
}

function ok(valueStatus: ServiceStatus, value: TtsSynthesisResult): SafeAdapterResult<TtsSynthesisResult> {
  return {
    ok: true,
    status: valueStatus,
    value
  };
}

function degraded(
  kind: SafeAdapterErrorKind,
  message: string,
  state: Extract<ServiceStatus["state"], "blocked" | "degraded" | "offline"> = "degraded"
): SafeAdapterResult<TtsSynthesisResult> {
  return {
    ok: false,
    degraded: true,
    status: createStatus(state, message),
    error: {
      kind,
      message,
      recoverable: state !== "blocked"
    }
  };
}

function validateRawConfig(config: GptSovitsTtsConfig): { readonly safe: true } | { readonly safe: false; readonly message: string } {
  if (containsForbiddenConfigKey(config)) {
    return {
      safe: false,
      message: "GPT-SoVITS config must not include model paths, reference audio paths, or private assets"
    };
  }

  for (const value of collectStringValues(config)) {
    if (!sanitizeText(value).safe) {
      return {
        safe: false,
        message: "GPT-SoVITS config contains unsafe private data"
      };
    }
  }

  return { safe: true };
}

function validateConfig(
  config: NormalizedGptSovitsTtsConfig
): { readonly safe: true } | { readonly safe: false; readonly message: string } {
  if (config.timeoutMs <= 0 || !Number.isFinite(config.timeoutMs)) {
    return {
      safe: false,
      message: "GPT-SoVITS timeoutMs must be a positive finite number"
    };
  }

  if (config.mode === "http" && config.endpoint && !isLoopbackEndpoint(config.endpoint)) {
    return {
      safe: false,
      message: "GPT-SoVITS endpoint must be a local loopback HTTP URL"
    };
  }

  for (const value of [config.endpoint, config.label, config.statusPath, config.synthesizePath]) {
    if (typeof value === "string" && !sanitizeText(value).safe) {
      return {
        safe: false,
        message: "GPT-SoVITS config contains unsafe private data"
      };
    }
  }

  return { safe: true };
}

function validateRequest(
  request: TtsSynthesisRequest
): { readonly safe: true } | { readonly safe: false; readonly message: string } {
  if (!request.id.trim()) {
    return {
      safe: false,
      message: "TTS request id is empty"
    };
  }

  if (request.text.length > MAX_TEXT_LENGTH) {
    return {
      safe: false,
      message: `TTS request text exceeds ${MAX_TEXT_LENGTH} characters`
    };
  }

  for (const value of [request.id, request.text, request.locale, request.voice, request.emotion]) {
    if (typeof value === "string" && !sanitizeText(value).safe) {
      return {
        safe: false,
        message: "TTS request contains unsafe private data"
      };
    }
  }

  if (typeof request.speed === "number" && (!Number.isFinite(request.speed) || request.speed <= 0)) {
    return {
      safe: false,
      message: "TTS speed must be a positive finite number"
    };
  }

  for (const value of [request.topP, request.temperature]) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      return {
        safe: false,
        message: "TTS sampling values must be finite non-negative numbers"
      };
    }
  }

  if (request.metadata) {
    for (const [key, value] of Object.entries(request.metadata)) {
      if (!sanitizeText(key).safe || (typeof value === "string" && !sanitizeText(value).safe)) {
        return {
          safe: false,
          message: "TTS metadata contains unsafe private data"
        };
      }
    }
  }

  return { safe: true };
}

function parseServiceResult(
  value: GptSovitsServiceResult,
  request: TtsSynthesisRequest
):
  | { readonly ok: true; readonly value: TtsSynthesisResult }
  | { readonly ok: false; readonly kind: SafeAdapterErrorKind; readonly message: string } {
  if (!isServiceResult(value)) {
    return {
      ok: false,
      kind: "invalid-response",
      message: "GPT-SoVITS service returned an invalid synthesis result"
    };
  }

  for (const field of [value.id, value.requestId, value.audioUrl, value.createdAt, value.mimeType]) {
    if (typeof field === "string" && !sanitizeText(field).safe) {
      return {
        ok: false,
        kind: "unsafe-output",
        message: UNSAFE_DETAIL
      };
    }
  }

  if (!isAllowedAudioUrl(value.audioUrl)) {
    return {
      ok: false,
      kind: "unsafe-output",
      message: "GPT-SoVITS service returned an unsupported audio URL"
    };
  }

  return {
    ok: true,
    value: {
      id: value.id,
      requestId: value.requestId || request.id,
      source: "gpt-sovits",
      audioUrl: value.audioUrl,
      format: value.format ?? "wav",
      mimeType: value.mimeType ?? "audio/wav",
      createdAt: value.createdAt ?? request.createdAt ?? new Date().toISOString(),
      durationMs: value.durationMs,
      cached: value.cached
    }
  };
}

function isServiceStatus(value: unknown): value is GptSovitsServiceStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "available" in value &&
    typeof (value as GptSovitsServiceStatus).available === "boolean" &&
    optionalString((value as GptSovitsServiceStatus).detail)
  );
}

function isServiceResult(value: unknown): value is GptSovitsServiceResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GptSovitsServiceResult).id === "string" &&
    typeof (value as GptSovitsServiceResult).requestId === "string" &&
    typeof (value as GptSovitsServiceResult).audioUrl === "string" &&
    optionalWavFormat((value as GptSovitsServiceResult).format) &&
    optionalWavMime((value as GptSovitsServiceResult).mimeType) &&
    optionalString((value as GptSovitsServiceResult).createdAt) &&
    optionalNumber((value as GptSovitsServiceResult).durationMs) &&
    optionalBoolean((value as GptSovitsServiceResult).cached)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalWavFormat(value: unknown): boolean {
  return value === undefined || value === "wav";
}

function optionalWavMime(value: unknown): boolean {
  return value === undefined || value === "audio/wav";
}

function isAllowedAudioUrl(value: string): boolean {
  if (!value.endsWith(".wav")) {
    return false;
  }

  if (value.startsWith("amadeus-mock://")) {
    return true;
  }

  if (value.startsWith("http://127.0.0.1:")) {
    return true;
  }

  if (!value.startsWith("file://")) {
    return false;
  }

  let pathname = "";
  try {
    pathname = new URL(value).pathname;
  } catch {
    return false;
  }

  return (
    pathname.includes("/amadeus-tts-cache/") ||
    pathname.includes("/amadeus-tts-dry-run") ||
    pathname.includes("/tts-cache/")
  );
}

function containsForbiddenConfigKey(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenConfigKeys.has(key)) {
      return true;
    }

    if (typeof child === "object" && child !== null && containsForbiddenConfigKey(child)) {
      return true;
    }
  }

  return false;
}

function collectStringValues(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.values(value).flatMap((item) => collectStringValues(item));
}

function isLoopbackEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}

async function readJson(response: FetchLikeResponse): Promise<unknown> {
  if (response.json) {
    return response.json();
  }

  if (response.text) {
    return JSON.parse(await response.text());
  }

  throw new GptSovitsHttpError("GPT-SoVITS response has no JSON reader");
}

function toWireRequest(request: TtsSynthesisRequest): Record<string, unknown> {
  return {
    id: request.id,
    text: request.text,
    locale: request.locale ?? "ja",
    voice: request.voice,
    emotion: request.emotion,
    speed: request.speed,
    topP: request.topP,
    temperature: request.temperature,
    metadata: request.metadata
  };
}

async function fetchWithTimeout(
  fetcher: FetchLike,
  input: string,
  init: NonNullable<Parameters<FetchLike>[1]>,
  timeoutMs: number
): Promise<FetchLikeResponse> {
  if (typeof AbortController === "undefined") {
    return fetcher(input, init);
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

function sanitizeThrowable(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return sanitizeText(error.message).text || fallback;
  }

  if (typeof error === "string") {
    return sanitizeText(error).text || fallback;
  }

  return fallback;
}

function sanitizeText(text: string): { readonly safe: boolean; readonly text: string } {
  let safe = true;
  let sanitized = text.slice(0, MAX_TEXT_LENGTH);

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

class GptSovitsHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GptSovitsHttpError";
  }
}

const forbiddenConfigKeys = new Set([
  "bertModelPath",
  "gptModelPath",
  "gptWeightsPath",
  "gpt_path",
  "modelDir",
  "modelPath",
  "refAudioPath",
  "refWavPath",
  "ref_wav_path",
  "ref_audio_path",
  "referenceAudioPath",
  "sovitsModelPath",
  "sovitsWeightsPath",
  "sovits_path",
  "weightsPath"
]);

const unsafePatterns: readonly RegExp[] = [
  /(?:\/home|\/Users)\/[^/\s"'`<>)]*\/[^\s"'`<>)]*(?:token|secret|cookie|credential|\.env|raw_extracted|\.ogg|\.wav|\.mp3|\.pth|\.ckpt|\.safetensors|\.psd)[^\s"'`<>)]*/gi,
  /\b[A-Z]:\\+Users\\+[^\\/\s"'`<>)]*\\+[^\s"'`<>)]*(?:token|secret|cookie|credential|\.env|raw_extracted|\.ogg|\.wav|\.mp3|\.pth|\.ckpt|\.safetensors|\.psd)[^\s"'`<>)]*/gi,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|cookie|credential|password)\s*[:=]\s*[^\s"'`<>]+/gi,
  /\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_]{12,}\b/g
];
