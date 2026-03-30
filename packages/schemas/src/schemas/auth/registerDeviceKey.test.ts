import { describe, expect, test } from "bun:test";
import { createDeviceKeyPair, DEVICE_KEY_ALGORITHM, encodeBase64 } from "@openbeacon/encryption";
import { registerDeviceKeySchema } from "./registerDeviceKey.ts";

describe("registerDeviceKeySchema", () => {
  test("accepts a valid X25519 public key and trims surrounding whitespace", () => {
    const deviceKeyPair = createDeviceKeyPair();
    const publicKey = ` ${deviceKeyPair.publicKey.slice(0, 8)}\n${deviceKeyPair.publicKey.slice(8)} `;

    expect(
      registerDeviceKeySchema.parse({
        algorithm: deviceKeyPair.algorithm,
        deviceId: "device-a",
        publicKey,
      }),
    ).toEqual({
      algorithm: deviceKeyPair.algorithm,
      deviceId: "device-a",
      publicKey: publicKey.trim(),
    });
  });

  test("rejects malformed base64", () => {
    expect(() =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "not-base64!",
      }),
    ).toThrow("Invalid device public key.");
  });

  test("rejects decoded keys with the wrong length", () => {
    expect(() =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: encodeBase64(new Uint8Array([1, 2, 3])),
      }),
    ).toThrow("Invalid device public key.");
  });
});
