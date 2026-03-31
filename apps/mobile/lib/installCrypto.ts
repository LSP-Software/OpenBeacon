import * as ExpoCrypto from "expo-crypto";

export const installExpoCrypto = () => {
  const existingCrypto = globalThis.crypto;

  if (
    typeof existingCrypto?.getRandomValues === "function" &&
    typeof existingCrypto.randomUUID === "function"
  ) {
    return;
  }

  const nextCrypto = Object.create(existingCrypto ?? null) as {
    getRandomValues: typeof ExpoCrypto.getRandomValues;
    randomUUID: typeof ExpoCrypto.randomUUID;
  };

  nextCrypto.getRandomValues =
    typeof existingCrypto?.getRandomValues === "function"
      ? existingCrypto.getRandomValues.bind(existingCrypto)
      : ExpoCrypto.getRandomValues;
  nextCrypto.randomUUID =
    typeof existingCrypto?.randomUUID === "function"
      ? existingCrypto.randomUUID.bind(existingCrypto)
      : ExpoCrypto.randomUUID;

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: true,
    value: nextCrypto,
    writable: true,
  });
};

installExpoCrypto();
