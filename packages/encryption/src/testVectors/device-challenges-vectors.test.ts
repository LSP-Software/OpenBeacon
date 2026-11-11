import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { openBase, sealBase } from "../hpke.ts";
import {
  DevicePrivateKeyMaterial,
  decodeBase64,
  encodeBase64,
  HistoryPrivateKeyMaterial,
  openDeviceActivationChallenge,
  openSessionLinkChallenge,
  sealDeviceActivationChallenge,
  sealSessionLinkChallenge,
} from "../index.ts";

type ChallengeVector = {
  ciphertextBase64: string;
  encBase64: string;
  infoJson: string;
  recipientPrivateKeyHex: string;
  recipientPublicKeyBase64: string;
};

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "device-challenges-v1.json"), "utf8"),
) as {
  challengeHex: string;
  deviceActivation: ChallengeVector;
  deviceId: string;
  ephemeralPrivateKeyHex: string;
  sessionLink: ChallengeVector;
  userId: string;
  version: number;
};
const textEncoder = new TextEncoder();
const challenge = hexToBytes(vectors.challengeHex);
const binding = { deviceId: vectors.deviceId, userId: vectors.userId };

const expectHpkeBaseOverInfo = (vector: ChallengeVector) => {
  expect(
    bytesToHex(
      openBase({
        aad: new Uint8Array(),
        ciphertext: decodeBase64(vector.ciphertextBase64),
        enc: decodeBase64(vector.encBase64),
        info: textEncoder.encode(vector.infoJson),
        recipientPrivateKey: hexToBytes(vector.recipientPrivateKeyHex),
      }),
    ),
  ).toBe(vectors.challengeHex);
};

const sealWithInfo = (vector: ChallengeVector, plaintext: Uint8Array) => {
  const sealed = sealBase({
    aad: new Uint8Array(),
    info: textEncoder.encode(vector.infoJson),
    plaintext,
    recipientPublicKey: decodeBase64(vector.recipientPublicKeyBase64),
  });
  return { ciphertext: encodeBase64(sealed.ciphertext), enc: encodeBase64(sealed.enc) };
};

describe("device challenge v1 vectors", () => {
  test("the session link challenge is HPKE Base over the documented info", () => {
    expect(vectors.version).toBe(1);
    expect(
      sealSessionLinkChallenge({
        ...binding,
        challenge,
        devicePublicKey: vectors.sessionLink.recipientPublicKeyBase64,
        ephemeralPrivateKey: hexToBytes(vectors.ephemeralPrivateKeyHex),
      }),
    ).toEqual({
      ciphertext: vectors.sessionLink.ciphertextBase64,
      enc: vectors.sessionLink.encBase64,
    });
    expectHpkeBaseOverInfo(vectors.sessionLink);
  });

  test("the device opens the vector session link challenge", () => {
    expect(
      openSessionLinkChallenge({
        ...binding,
        devicePrivateKey: new DevicePrivateKeyMaterial(
          hexToBytes(vectors.sessionLink.recipientPrivateKeyHex),
        ),
        sealed: {
          ciphertext: vectors.sessionLink.ciphertextBase64,
          enc: vectors.sessionLink.encBase64,
        },
      }),
    ).toBe(encodeBase64(challenge));
  });

  test("the activation challenge is HPKE Base over the documented info", () => {
    expect(
      sealDeviceActivationChallenge({
        ...binding,
        challenge,
        ephemeralPrivateKey: hexToBytes(vectors.ephemeralPrivateKeyHex),
        historyPublicKey: vectors.deviceActivation.recipientPublicKeyBase64,
      }),
    ).toEqual({
      ciphertext: vectors.deviceActivation.ciphertextBase64,
      enc: vectors.deviceActivation.encBase64,
    });
    expectHpkeBaseOverInfo(vectors.deviceActivation);
  });

  test("the History key opens the vector activation challenge", () => {
    expect(
      openDeviceActivationChallenge({
        ...binding,
        historyPrivateKey: new HistoryPrivateKeyMaterial(
          hexToBytes(vectors.deviceActivation.recipientPrivateKeyHex),
        ),
        sealed: {
          ciphertext: vectors.deviceActivation.ciphertextBase64,
          enc: vectors.deviceActivation.encBase64,
        },
      }),
    ).toBe(encodeBase64(challenge));
  });

  test("opening refuses a challenge that isn't 32 bytes", () => {
    for (const length of [16, 33]) {
      expect(() =>
        openSessionLinkChallenge({
          ...binding,
          devicePrivateKey: new DevicePrivateKeyMaterial(
            hexToBytes(vectors.sessionLink.recipientPrivateKeyHex),
          ),
          sealed: sealWithInfo(vectors.sessionLink, new Uint8Array(length)),
        }),
      ).toThrow("Invalid session link challenge length.");
      expect(() =>
        openDeviceActivationChallenge({
          ...binding,
          historyPrivateKey: new HistoryPrivateKeyMaterial(
            hexToBytes(vectors.deviceActivation.recipientPrivateKeyHex),
          ),
          sealed: sealWithInfo(vectors.deviceActivation, new Uint8Array(length)),
        }),
      ).toThrow("Invalid device activation challenge length.");
    }
  });
});
