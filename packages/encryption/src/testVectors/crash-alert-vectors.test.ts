import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  CRASH_ALERT_LENGTH,
  CRASH_ALERT_VERSION,
  type CrashAlertMessage,
  crashAlertAssociatedData,
  decodeCrashAlert,
  ENCRYPTED_CRASH_ALERT_LENGTH,
  EpochKeyMaterial,
  encodeCrashAlert,
  openCrashAlert,
  sealCrashAlert,
} from "../index.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "crash-alert-v1.json"), "utf8"),
) as {
  decodeReject: { hex: string; name: string }[];
  encode: { decoded: CrashAlertMessage; hex: string; message: CrashAlertMessage; name: string }[];
  encodeReject: { message: CrashAlertMessage; name: string }[];
  encryptedLength: number;
  length: number;
  sealed: {
    cases: {
      aadJson: string;
      ciphertextBase64: string;
      metadata: { epochId: string; groupId: string; messageId: string; senderDeviceId: string };
      name: string;
    }[];
    epochKeyHex: string;
    nonceHex: string;
  };
  version: number;
};

describe("crash alert vectors", () => {
  test("vector file matches the locked version and lengths", () => {
    expect(vectors.version).toBe(CRASH_ALERT_VERSION);
    expect(vectors.length).toBe(CRASH_ALERT_LENGTH);
    expect(vectors.encryptedLength).toBe(ENCRYPTED_CRASH_ALERT_LENGTH);
  });

  test("encodes each message to the committed bytes and decodes them back", () => {
    for (const testCase of vectors.encode) {
      expect({ name: testCase.name, hex: bytesToHex(encodeCrashAlert(testCase.message)) }).toEqual({
        name: testCase.name,
        hex: testCase.hex,
      });
      expect(decodeCrashAlert(hexToBytes(testCase.hex))).toEqual(testCase.decoded);
    }
  });

  test("refuses each rejected message and payload", () => {
    for (const testCase of vectors.encodeReject) {
      expect(() => encodeCrashAlert(testCase.message)).toThrow("Invalid crash alert.");
    }
    for (const testCase of vectors.decodeReject) {
      expect(() => decodeCrashAlert(hexToBytes(testCase.hex))).toThrow("Invalid crash alert.");
    }
  });

  test("seals each message to the committed ciphertext", () => {
    const epochKey = new EpochKeyMaterial(hexToBytes(vectors.sealed.epochKeyHex));
    for (const testCase of vectors.sealed.cases) {
      const message = vectors.encode.find(({ name }) => name === testCase.name)?.message;
      if (!message) throw new Error(`Missing message ${testCase.name}`);
      const { messageId: _, ...metadata } = testCase.metadata;
      const sealed = sealCrashAlert({
        ...metadata,
        epochKey,
        message,
        nonce: hexToBytes(vectors.sealed.nonceHex),
      });
      expect(sealed.ciphertext).toBe(testCase.ciphertextBase64);
      expect(new TextDecoder().decode(crashAlertAssociatedData(testCase.metadata))).toBe(
        testCase.aadJson,
      );
      expect(openCrashAlert({ ...metadata, epochKey, sealed })).toEqual(message);
    }
  });
});
