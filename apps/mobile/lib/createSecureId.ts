export const createSecureId = (prefix: string) => {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure random UUID generation is unavailable.");
  }

  return `${prefix}_${globalThis.crypto.randomUUID()}`;
};
