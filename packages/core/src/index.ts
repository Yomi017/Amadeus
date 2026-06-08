export type AmadeusStage =
  | "stage-1-scaffold"
  | "stage-2-desktop-shell"
  | "stage-3-core-hermes-adapter"
  | "stage-4-gpt-sovits-tts-provider"
  | "stage-5-static-renderer-boundary";

export type ServiceState = "available" | "mock" | "offline" | "degraded" | "blocked";

export interface ServiceStatus {
  readonly id: "hermes" | "tts" | "renderer" | "assets";
  readonly label: string;
  readonly state: ServiceState;
  readonly detail: string;
  readonly checkedAt?: string;
}

export type ChatRole = "user" | "assistant" | "system";
export type ChatMessageStatus = "pending" | "complete" | "cancelled";

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
  readonly status: ChatMessageStatus;
  readonly createdAt: string;
  readonly speechState?: "idle" | "mock-speaking" | "stopped";
}

export type CharacterEmotion = "neutral" | "soft" | "happy" | "focused";

export interface CharacterState {
  readonly emotion: CharacterEmotion;
  readonly speaking: boolean;
  readonly mouthOpen: boolean;
  readonly pose: "idle" | "listening" | "replying";
}

export type AssistantReplySource = "mock" | "hermes";

export interface AssistantReply {
  readonly id: string;
  readonly role: "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly source: AssistantReplySource;
}

export interface HermesChatMessage {
  readonly role: ChatRole;
  readonly text: string;
  readonly createdAt?: string;
}

export interface HermesChatRequest {
  readonly id: string;
  readonly messages: readonly HermesChatMessage[];
  readonly createdAt?: string;
  readonly locale?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export type HermesAdapterMode = "mock" | "real";

export interface HermesAdapterConfig {
  readonly mode?: HermesAdapterMode;
  readonly label?: string;
}

export type SafeAdapterErrorKind = "offline" | "transport-error" | "invalid-response" | "unsafe-output";

export interface SafeAdapterError {
  readonly kind: SafeAdapterErrorKind;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface SafeAdapterSuccess<T> {
  readonly ok: true;
  readonly status: ServiceStatus;
  readonly value: T;
}

export interface SafeAdapterDegraded<T> {
  readonly ok: false;
  readonly degraded: true;
  readonly status: ServiceStatus;
  readonly error: SafeAdapterError;
  readonly fallback?: T;
}

export type SafeAdapterResult<T> = SafeAdapterSuccess<T> | SafeAdapterDegraded<T>;

export interface HermesAdapter {
  readonly mode: HermesAdapterMode;
  readonly config: HermesAdapterConfig;
  status(): Promise<ServiceStatus>;
  request(request: HermesChatRequest): Promise<SafeAdapterResult<AssistantReply>>;
}

export type TtsProviderMode = "mock" | "http";
export type TtsAudioFormat = "wav";
export type TtsResultSource = "mock" | "gpt-sovits";

export interface TtsSynthesisRequest {
  readonly id: string;
  readonly text: string;
  readonly locale?: string;
  readonly voice?: string;
  readonly emotion?: CharacterEmotion;
  readonly speed?: number;
  readonly topP?: number;
  readonly temperature?: number;
  readonly createdAt?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface TtsSynthesisResult {
  readonly id: string;
  readonly requestId: string;
  readonly source: TtsResultSource;
  readonly audioUrl: string;
  readonly format: TtsAudioFormat;
  readonly mimeType: "audio/wav";
  readonly createdAt: string;
  readonly durationMs?: number;
  readonly cached?: boolean;
}

export interface TtsProviderConfig {
  readonly mode?: TtsProviderMode;
  readonly endpoint?: string;
  readonly label?: string;
  readonly timeoutMs?: number;
}

export interface TtsProvider {
  readonly mode: TtsProviderMode;
  readonly config: TtsProviderConfig;
  status(): Promise<ServiceStatus>;
  synthesize(request: TtsSynthesisRequest): Promise<SafeAdapterResult<TtsSynthesisResult>>;
}

export type StaticRendererMode = "fallback" | "private-image";
export type StaticRendererSourceKind = "css-fallback" | "private-file";

export interface StaticRendererConfig {
  readonly mode?: StaticRendererMode;
  readonly privateImagePath?: string;
  readonly label?: string;
}

export interface StaticRendererAssetDescriptor {
  readonly id: string;
  readonly sourceKind: StaticRendererSourceKind;
  readonly label: string;
  readonly safeDescription: string;
}

export interface StaticRendererSnapshot {
  readonly asset: StaticRendererAssetDescriptor;
  readonly character: CharacterState;
  readonly className: string;
  readonly speakingClassName: string;
}

export interface StaticCharacterRenderer {
  readonly mode: StaticRendererMode;
  readonly config: StaticRendererConfig;
  status(): Promise<ServiceStatus>;
  snapshot(state: CharacterState): SafeAdapterResult<StaticRendererSnapshot>;
}

export const AMADEUS_STAGE: AmadeusStage = "stage-5-static-renderer-boundary";

export const STAGE_2_SERVICE_STATUSES: readonly ServiceStatus[] = [
  {
    id: "hermes",
    label: "Hermes",
    state: "mock",
    detail: "Mock chat boundary"
  },
  {
    id: "tts",
    label: "TTS",
    state: "mock",
    detail: "No audio synthesis yet"
  },
  {
    id: "renderer",
    label: "Renderer",
    state: "mock",
    detail: "Static fallback renderer"
  },
  {
    id: "assets",
    label: "Assets",
    state: "blocked",
    detail: "Private character assets excluded"
  }
];

export const STAGE_3_SERVICE_STATUSES: readonly ServiceStatus[] = [
  {
    id: "hermes",
    label: "Hermes",
    state: "mock",
    detail: "Core adapter mock ready"
  },
  {
    id: "tts",
    label: "TTS",
    state: "mock",
    detail: "No audio synthesis yet"
  },
  {
    id: "renderer",
    label: "Renderer",
    state: "mock",
    detail: "Static fallback renderer"
  },
  {
    id: "assets",
    label: "Assets",
    state: "blocked",
    detail: "Private character assets excluded"
  }
];

export const STAGE_4_SERVICE_STATUSES: readonly ServiceStatus[] = [
  {
    id: "hermes",
    label: "Hermes",
    state: "mock",
    detail: "Core adapter mock ready"
  },
  {
    id: "tts",
    label: "TTS",
    state: "mock",
    detail: "GPT-SoVITS HTTP provider boundary ready"
  },
  {
    id: "renderer",
    label: "Renderer",
    state: "mock",
    detail: "Static fallback renderer"
  },
  {
    id: "assets",
    label: "Assets",
    state: "blocked",
    detail: "Private character assets excluded"
  }
];

export const STAGE_5_SERVICE_STATUSES: readonly ServiceStatus[] = [
  {
    id: "hermes",
    label: "Hermes",
    state: "mock",
    detail: "Core adapter mock ready"
  },
  {
    id: "tts",
    label: "TTS",
    state: "mock",
    detail: "GPT-SoVITS HTTP provider boundary ready"
  },
  {
    id: "renderer",
    label: "Renderer",
    state: "mock",
    detail: "Static fallback renderer boundary ready"
  },
  {
    id: "assets",
    label: "Assets",
    state: "blocked",
    detail: "Private character assets excluded"
  }
];
