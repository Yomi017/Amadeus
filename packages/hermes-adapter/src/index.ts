import type {
  AssistantReply,
  HermesAdapter,
  HermesAdapterConfig,
  HermesAdapterMode,
  HermesChatRequest,
  SafeAdapterErrorKind,
  SafeAdapterResult,
  ServiceStatus
} from "@amadeus/core";

export interface HermesTransportStatus {
  readonly available: boolean;
  readonly detail?: string;
}

export interface HermesTransportReply {
  readonly text: string;
  readonly id?: string;
  readonly createdAt?: string;
}

export interface HermesTransport {
  readonly status: () => Promise<HermesTransportStatus> | HermesTransportStatus;
  readonly request: (request: HermesChatRequest) => Promise<HermesTransportReply> | HermesTransportReply;
}

const DEFAULT_LABEL = "Hermes";
const MOCK_CREATED_AT = "2026-06-08T00:00:00.000Z";
const REDACTED = "[redacted]";
const UNSAFE_DETAIL = "Transport returned unsafe private data";
const MAX_REPLY_TEXT_LENGTH = 4_000;

export function createHermesAdapter(config: HermesAdapterConfig = {}, transport?: HermesTransport): HermesAdapter {
  const mode: HermesAdapterMode = config.mode ?? "mock";
  const normalizedConfig: HermesAdapterConfig = {
    ...config,
    mode
  };

  return {
    mode,
    config: normalizedConfig,
    async status(): Promise<ServiceStatus> {
      if (mode === "mock") {
        return createStatus("mock", "Mock Hermes adapter ready");
      }

      if (!transport) {
        return createStatus("offline", "Real Hermes transport is not injected");
      }

      try {
        const transportStatus = await transport.status();

        if (!isTransportStatus(transportStatus)) {
          return createStatus("degraded", "Transport returned an invalid Hermes status");
        }

        const sanitizedDetail = sanitizeText(transportStatus.detail ?? "");

        if (!sanitizedDetail.safe) {
          return createStatus("degraded", UNSAFE_DETAIL);
        }

        return createStatus(
          transportStatus.available ? "available" : "degraded",
          sanitizedDetail.text || (transportStatus.available ? "Injected Hermes transport ready" : "Injected Hermes transport unavailable")
        );
      } catch (error) {
        return createStatus("degraded", sanitizeThrowable(error));
      }
    },
    async request(request: HermesChatRequest): Promise<SafeAdapterResult<AssistantReply>> {
      if (mode === "mock") {
        return ok(createStatus("mock", "Mock Hermes adapter ready"), buildMockAssistantReply(request));
      }

      if (!transport) {
        return degraded("offline", "Real Hermes transport is not injected");
      }

      try {
        const reply = await transport.request(request);

        if (!isTransportReply(reply)) {
          return degraded("invalid-response", "Transport returned an invalid Hermes reply");
        }

        const sanitizedText = sanitizeText(reply.text);
        const sanitizedId = sanitizeText(reply.id ?? "");
        const sanitizedCreatedAt = sanitizeText(reply.createdAt ?? "");

        if (!sanitizedText.safe || !sanitizedId.safe || !sanitizedCreatedAt.safe) {
          return degraded("unsafe-output", UNSAFE_DETAIL);
        }

        const text = sanitizedText.text.trim();
        if (!text) {
          return degraded("invalid-response", "Transport returned an empty Hermes reply");
        }

        return ok(createStatus("available", "Injected Hermes transport reply received"), {
          id: sanitizedId.text || makeReplyId(request),
          role: "assistant",
          text,
          createdAt: sanitizedCreatedAt.text || request.createdAt || new Date().toISOString(),
          source: "hermes"
        });
      } catch (error) {
        return degraded("transport-error", sanitizeThrowable(error));
      }
    }
  };
}

export function buildMockAssistantReply(request: HermesChatRequest): AssistantReply {
  const userText = latestUserText(request);
  const text = userText
    ? `聞こえている。「${userText}」のことだな。今はまだ mock mode だが、そばにいる。`
    : "ここにいる。用件を聞かせて。";

  return {
    id: makeReplyId(request),
    role: "assistant",
    text,
    createdAt: request.createdAt ?? MOCK_CREATED_AT,
    source: "mock"
  };
}

export function sanitizeHermesTextForTest(text: string): { readonly safe: boolean; readonly text: string } {
  return sanitizeText(text);
}

function createStatus(state: ServiceStatus["state"], detail: string): ServiceStatus {
  return {
    id: "hermes",
    label: DEFAULT_LABEL,
    state,
    detail
  };
}

function ok(status: ServiceStatus, value: AssistantReply): SafeAdapterResult<AssistantReply> {
  return {
    ok: true,
    status,
    value
  };
}

function degraded(kind: SafeAdapterErrorKind, message: string): SafeAdapterResult<AssistantReply> {
  return {
    ok: false,
    degraded: true,
    status: createStatus(kind === "offline" ? "offline" : "degraded", message),
    error: {
      kind,
      message,
      recoverable: true
    }
  };
}

function isTransportReply(value: unknown): value is HermesTransportReply {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as HermesTransportReply).text === "string" &&
    optionalString((value as HermesTransportReply).id) &&
    optionalString((value as HermesTransportReply).createdAt)
  );
}

function isTransportStatus(value: unknown): value is HermesTransportStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "available" in value &&
    typeof (value as HermesTransportStatus).available === "boolean" &&
    optionalString((value as HermesTransportStatus).detail)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function latestUserText(request: HermesChatRequest): string {
  const message = [...request.messages].reverse().find((candidate) => candidate.role === "user");
  return sanitizeMockText(message?.text ?? "");
}

function sanitizeMockText(text: string): string {
  return sanitizeText(text).text.trim().replace(/\s+/g, " ").slice(0, 280);
}

function makeReplyId(request: HermesChatRequest): string {
  return `hermes-reply-${stableHash(request.id)}`;
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeThrowable(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeText(error.message).text || "Hermes transport failed";
  }

  if (typeof error === "string") {
    return sanitizeText(error).text || "Hermes transport failed";
  }

  return "Hermes transport failed";
}

function sanitizeText(text: string): { readonly safe: boolean; readonly text: string } {
  let safe = true;
  let sanitized = text.slice(0, MAX_REPLY_TEXT_LENGTH);

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
  /(?:\/home|\/Users)\/[^/\s"'`<>)]*\/\.hermes(?:\/[^\s"'`<>)]*)?/gi,
  /(?:\/home|\/Users)\/[^/\s"'`<>)]*\/[^\s"'`<>)]*(?:token|secret|cookie|credential|\.env|\.hermes|raw_extracted|\.ogg|\.wav|\.pth|\.ckpt|\.psd)[^\s"'`<>)]*/gi,
  /\b[A-Z]:\\+Users\\+[^\\/\s"'`<>)]*\\+\.hermes(?:\\+[^\s"'`<>)]*)?/gi,
  /\b[A-Z]:\\+Users\\+[^\\/\s"'`<>)]*\\+[^\s"'`<>)]*(?:token|secret|cookie|credential|\.env|\.hermes|raw_extracted|\.ogg|\.wav|\.pth|\.ckpt|\.psd)[^\s"'`<>)]*/gi,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|cookie|credential|password)\s*[:=]\s*[^\s"'`<>]+/gi,
  /\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_]{12,}\b/g
];
