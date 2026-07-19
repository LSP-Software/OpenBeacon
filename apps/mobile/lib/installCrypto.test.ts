import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const expoRandomUUID = "123e4567-e89b-12d3-a456-426614174000" as const;
const getRandomValuesMock = mock(
  <
    T extends
      | Int8Array
      | Uint8Array
      | Int16Array
      | Uint16Array
      | Int32Array
      | Uint32Array
      | Uint8ClampedArray,
  >(
    typedArray: T,
  ) => typedArray,
);
const randomUUIDMock = mock(
  (): `${string}-${string}-${string}-${string}-${string}` => expoRandomUUID,
);
let platformOS: "android" | "ios" | "web" = "ios";

mock.module("expo-crypto", () => ({
  getRandomValues: getRandomValuesMock,
  randomUUID: randomUUIDMock,
}));

mock.module("react-native", () => createReactNativeTestModule({ platformOS }));

const importInstallCryptoModule = async () =>
  import(`./installCrypto.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./installCrypto.ts")
  >;

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

describe("installExpoCrypto", () => {
  beforeEach(() => {
    getRandomValuesMock.mockClear();
    randomUUIDMock.mockClear();
  });

  afterEach(() => {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "crypto");
  });

  test("installs Expo crypto methods when native crypto is missing", async () => {
    platformOS = "ios";
    Reflect.deleteProperty(globalThis, "crypto");

    await importInstallCryptoModule();

    expect(typeof globalThis.crypto?.getRandomValues).toBe("function");
    expect(typeof globalThis.crypto?.randomUUID).toBe("function");
    expect(globalThis.crypto?.getRandomValues).toBe(getRandomValuesMock);
    expect(globalThis.crypto?.randomUUID).toBe(randomUUIDMock);
  });

  test("preserves existing crypto methods and fills in missing ones on native", async () => {
    platformOS = "android";
    const existingRandomUUID = mock(
      (): `${string}-${string}-${string}-${string}-${string}` =>
        "123e4567-e89b-12d3-a456-426614174001",
    );

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: existingRandomUUID,
      },
      writable: true,
    });

    await importInstallCryptoModule();

    expect(globalThis.crypto?.randomUUID()).toBe("123e4567-e89b-12d3-a456-426614174001");
    expect(globalThis.crypto?.getRandomValues).toBe(getRandomValuesMock);
  });

  test("does not override web crypto", async () => {
    platformOS = "web";
    const existingGetRandomValues = mock((typedArray: Uint8Array) => typedArray);
    const existingRandomUUID = mock(
      (): `${string}-${string}-${string}-${string}-${string}` =>
        "123e4567-e89b-12d3-a456-426614174002",
    );
    const existingCrypto = {
      getRandomValues: existingGetRandomValues,
      randomUUID: existingRandomUUID,
    };

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: existingCrypto,
      writable: true,
    });

    await importInstallCryptoModule();

    expect(globalThis.crypto?.randomUUID()).toBe("123e4567-e89b-12d3-a456-426614174002");
    expect(globalThis.crypto?.getRandomValues).toBe(existingGetRandomValues);
    expect(globalThis.crypto?.randomUUID).toBe(existingRandomUUID);
  });
});
