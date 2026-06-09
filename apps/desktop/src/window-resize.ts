import { getCurrentWindow } from "@tauri-apps/api/window";

export type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export function resizeCurrentWindow(direction: ResizeDirection) {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  void getCurrentWindow().startResizeDragging(direction).catch(() => {
    // Resize dragging is best-effort and only works inside a Tauri window.
  });
}
