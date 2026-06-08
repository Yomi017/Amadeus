export interface PrivateCharacterImage {
  readonly src: string;
  readonly enabled: boolean;
}

export function getPrivateCharacterImage(): PrivateCharacterImage {
  const imagePath = import.meta.env.VITE_AMADEUS_PRIVATE_CHARACTER_IMAGE?.trim();

  if (!imagePath) {
    return {
      src: "",
      enabled: false
    };
  }

  if (imagePath.startsWith("http://") || imagePath.startsWith("https://") || imagePath.startsWith("/@fs/")) {
    return {
      src: imagePath,
      enabled: true
    };
  }

  if (/^[A-Za-z]:[\\/]/.test(imagePath) || imagePath.startsWith("\\\\")) {
    return {
      src: `/@fs/${imagePath.replace(/\\/g, "/")}`,
      enabled: true
    };
  }

  if (imagePath.startsWith("/")) {
    return {
      src: `/@fs${imagePath}`,
      enabled: true
    };
  }

  return {
    src: imagePath,
    enabled: true
  };
}
