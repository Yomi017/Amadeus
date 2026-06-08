export interface HermesAdapterStatus {
  readonly connected: boolean;
  readonly mode: "placeholder";
}

export const HERMES_ADAPTER_STATUS: HermesAdapterStatus = {
  connected: false,
  mode: "placeholder"
};

