import { describe, expect, test } from "bun:test";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  openDeviceActivationChallenge,
  sealDeviceActivationChallenge,
} from "./deviceActivation.ts";
import {
  createDeviceKeyPair,
  DevicePrivateKeyMaterial,
  encodeBase64,
  HistoryPrivateKeyMaterial,
} from "./index.ts";
import { openSessionLinkChallenge, sealSessionLinkChallenge } from "./sessionLink.ts";

const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
const deviceKey = createDeviceKeyPair();
const sealed = sealSessionLinkChallenge({
  challenge,
  deviceId: "device-1",
  devicePublicKey: deviceKey.publicKey,
  userId: "user-1",
});

describe("session link challenge", () => {
  test("opens with the device private key it was sealed to", () => {
    expect(
      openSessionLinkChallenge({
        deviceId: "device-1",
        devicePrivateKey: deviceKey.privateKey,
        sealed,
        userId: "user-1",
      }),
    ).toBe(encodeBase64(challenge));
  });

  test("doesn't open with another device's key", () => {
    expect(() =>
      openSessionLinkChallenge({
        deviceId: "device-1",
        devicePrivateKey: createDeviceKeyPair().privateKey,
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
        openSessionLinkChallenge({ ...binding, devicePrivateKey: deviceKey.privateKey, sealed }),
      ).toThrow();
    }
  });

  test("can't be opened as an activation challenge, or the other way round", () => {
    const sharedKey = x25519.keygen();
    const binding = { deviceId: "device-1", userId: "user-1" };
    const publicKey = encodeBase64(sharedKey.publicKey);
    const sessionLink = sealSessionLinkChallenge({
      ...binding,
      challenge,
      devicePublicKey: publicKey,
    });
    const activation = sealDeviceActivationChallenge({
      ...binding,
      challenge,
      historyPublicKey: publicKey,
    });

    expect(() =>
      openDeviceActivationChallenge({
        ...binding,
        historyPrivateKey: new HistoryPrivateKeyMaterial(sharedKey.secretKey),
        sealed: sessionLink,
      }),
    ).toThrow();
    expect(() =>
      openSessionLinkChallenge({
        ...binding,
        devicePrivateKey: new DevicePrivateKeyMaterial(sharedKey.secretKey),
        sealed: activation,
      }),
    ).toThrow();
  });

  test("refuses a challenge that isn't 32 bytes", () => {
    expect(() =>
      sealSessionLinkChallenge({
        challenge: new Uint8Array(16),
        deviceId: "device-1",
        devicePublicKey: deviceKey.publicKey,
        userId: "user-1",
      }),
    ).toThrow();
  });
});
