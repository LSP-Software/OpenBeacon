import { describe, expect, test } from "bun:test";
import {
  openDeviceActivationChallenge,
  sealDeviceActivationChallenge,
} from "./deviceActivation.ts";
import { createHistoryKeyPair, encodeBase64 } from "./index.ts";

const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
const historyKey = createHistoryKeyPair();
const sealed = sealDeviceActivationChallenge({
  challenge,
  deviceId: "device-1",
  historyPublicKey: historyKey.publicKey,
  userId: "user-1",
});

describe("device activation challenge", () => {
  test("opens with the History private key it was sealed to", () => {
    expect(
      openDeviceActivationChallenge({
        deviceId: "device-1",
        historyPrivateKey: historyKey.privateKey,
        sealed,
        userId: "user-1",
      }),
    ).toBe(encodeBase64(challenge));
  });

  test("doesn't open with another History key", () => {
    expect(() =>
      openDeviceActivationChallenge({
        deviceId: "device-1",
        historyPrivateKey: createHistoryKeyPair().privateKey,
        sealed,
        userId: "user-1",
      }),
    ).toThrow();
  });

  test("is bound to the user and device it was made for", () => {
    for (const binding of [
      { deviceId: "device-2", userId: "user-1" },
      { deviceId: "device-1", userId: "user-2" },
    ]) {
      expect(() =>
        openDeviceActivationChallenge({
          ...binding,
          historyPrivateKey: historyKey.privateKey,
          sealed,
        }),
      ).toThrow();
    }
  });

  test("refuses a challenge that isn't 32 bytes", () => {
    expect(() =>
      sealDeviceActivationChallenge({
        challenge: new Uint8Array(16),
        deviceId: "device-1",
        historyPublicKey: historyKey.publicKey,
        userId: "user-1",
      }),
    ).toThrow();
  });
});
