export type AmadeusStage = "stage-1-scaffold" | "stage-2-desktop-shell";

export type ServiceState = "available" | "mock" | "offline" | "blocked";

export interface ServiceStatus {
  readonly id: "hermes" | "tts" | "renderer" | "assets";
  readonly label: string;
  readonly state: ServiceState;
  readonly detail: string;
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

export const AMADEUS_STAGE: AmadeusStage = "stage-2-desktop-shell";

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
