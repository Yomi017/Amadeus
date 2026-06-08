import { getCurrentWindow } from "@tauri-apps/api/window";

export function ensurePetWindowMode() {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  const currentWindow = getCurrentWindow();

  void Promise.allSettled([
    currentWindow.setAlwaysOnTop(true),
    currentWindow.setSkipTaskbar(true),
    currentWindow.setVisibleOnAllWorkspaces(true)
  ]);
}
