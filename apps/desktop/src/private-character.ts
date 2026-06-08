import { convertFileSrc } from "@tauri-apps/api/core";

const VITE_FS_PREFIX = "/@fs/";
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export interface PrivateCharacterImage {
  readonly src: string;
  readonly enabled: boolean;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function normalizeViteFsPath(imagePath: string): string {
  if (!imagePath.startsWith(VITE_FS_PREFIX)) {
    return imagePath;
  }

  const absolutePath = imagePath.slice(VITE_FS_PREFIX.length);

  if (WINDOWS_ABSOLUTE_PATH.test(absolutePath) || absolutePath.startsWith("/")) {
    return absolutePath;
  }

  return `/${absolutePath}`;
}

export function getPrivateCharacterImage(): PrivateCharacterImage {
  const configuredPath = import.meta.env.VITE_AMADEUS_PRIVATE_CHARACTER_IMAGE?.trim();

  if (!configuredPath) {
    return {
      src: "",
      enabled: false
    };
  }

  const imagePath = normalizeViteFsPath(configuredPath);
  const isAbsolutePath =
    WINDOWS_ABSOLUTE_PATH.test(imagePath) || imagePath.startsWith("\\\\") || imagePath.startsWith("/");

  if (isTauriRuntime() && isAbsolutePath) {
    return {
      src: convertFileSrc(imagePath),
      enabled: true
    };
  }

  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return {
      src: imagePath,
      enabled: true
    };
  }

  if (isAbsolutePath) {
    if (imagePath.startsWith("/")) {
      return {
        src: `/@fs${imagePath}`,
        enabled: true
      };
    }

    return {
      src: `/@fs/${imagePath.replace(/\\/g, "/")}`,
      enabled: true
    };
  }

  return {
    src: imagePath,
    enabled: true
  };
}
