export interface GptSovitsTtsStatus {
  readonly provider: "gpt-sovits";
  readonly ready: boolean;
}

export const GPT_SOVITS_TTS_STATUS: GptSovitsTtsStatus = {
  provider: "gpt-sovits",
  ready: false
};

