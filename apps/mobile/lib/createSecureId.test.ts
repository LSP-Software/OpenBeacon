import { afterEach, describe, expect, mock, test } from "bun:test";
import { createSecureId } from "./createSecureId.ts";

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

const restoreCrypto = () => {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, "crypto");
};

describe("createSecureId", () => {
  afterEach(() => {
    restoreCrypto();
  });

  test("prefixes crypto.randomUUID output", () => {
    const randomUUID = mock(
      (): `${string}-${string}-${string}-${string}-${string}` =>
        "123e4567-e89b-12d3-a456-426614174111",
    );
    const nextCrypto = Object.create(globalThis.crypto ?? null) as Crypto;

    Object.defineProperty(nextCrypto, "randomUUID", {
      value: randomUUID,
      writable: true,
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: nextCrypto,
      writable: true,
    });

    expect(createSecureId("device")).toBe("device_123e4567-e89b-12d3-a456-426614174111");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  test("throws when secure UUID generation is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
      writable: true,
    });

    expect(() => createSecureId("device")).toThrow("Secure random UUID generation is unavailable.");
  });
});
