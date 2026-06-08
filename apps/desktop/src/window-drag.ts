import { getCurrentWindow } from "@tauri-apps/api/window";

export function dragCurrentWindow() {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  void getCurrentWindow().startDragging().catch(() => {
    // Dragging is best-effort and may be unsupported outside a Tauri window.
  });
}
