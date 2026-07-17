import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeBase64,
  decodeJsonPayload,
  decryptGroupPayload,
  EpochKeyMaterial,
  encodeBase64,
  encryptGroupPayload,
  PAYLOAD_ENCRYPTION_ALGORITHM,
} from "../index.ts";

const vectorsPath = join(dirname(fileURLToPath(import.meta.url)), "group-payload-interop-v1.json");

const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  algorithm: string;
  cases: {
    aadJson: string;
    ciphertextBase64: string;
    metadata: {
      epochId: string;
      groupId: string;
      kind: string;
      senderDeviceId: string;
    };
    name: string;
    nonceBase64: string;
    plaintextBase64: string;
    plaintextJson: string;
  }[];
  constants: {
    domainContext: string;
    epochKeyBase64: string;
    epochKeyHex: string;
    kind: string;
    nonceBase64: string;
    nonceHex: string;
    purpose: string;
  };
  version: number;
};

const hexToBytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
};

describe("group-payload interop vectors", () => {
  test("vector file uses the locked algorithm and domain context", () => {
    expect(vectors.version).toBe(1);
    expect(vectors.algorithm).toBe(PAYLOAD_ENCRYPTION_ALGORITHM);
    expect(vectors.constants.domainContext).toBe("openbeacon.group-epoch.v1");
    expect(vectors.constants.purpose).toBe("payload");
    expect(vectors.constants.kind).toBe("trackingPoint");
  });

  test("TypeScript encrypt matches committed ciphertext for each vector", () => {
    const epochKey = new EpochKeyMaterial(hexToBytes(vectors.constants.epochKeyHex));
    const nonce = hexToBytes(vectors.constants.nonceHex);

    for (const testCase of vectors.cases) {
      const encrypted = encryptGroupPayload({
        epochId: testCase.metadata.epochId,
        epochKey,
        groupId: testCase.metadata.groupId,
        kind: testCase.metadata.kind,
        nonce,
        payload: JSON.parse(testCase.plaintextJson) as Record<string, unknown>,
        senderDeviceId: testCase.metadata.senderDeviceId,
      });

      expect(encrypted.algorithm).toBe(PAYLOAD_ENCRYPTION_ALGORITHM);
      expect(encrypted.nonce).toBe(testCase.nonceBase64);
      expect(encrypted.ciphertext).toBe(testCase.ciphertextBase64);
      expect(encrypted.epochId).toBe(testCase.metadata.epochId);
      expect(encrypted.groupId).toBe(testCase.metadata.groupId);
      expect(encrypted.kind).toBe(testCase.metadata.kind);
      expect(encrypted.senderDeviceId).toBe(testCase.metadata.senderDeviceId);
    }
  });

  test("TypeScript decrypt recovers plaintext for each vector", () => {
    const epochKey = new EpochKeyMaterial(decodeBase64(vectors.constants.epochKeyBase64));

    for (const testCase of vectors.cases) {
      const decrypted = decryptGroupPayload({
        encryptedPayload: {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: testCase.ciphertextBase64,
          createdAt: new Date("2026-07-13T18:45:00.000Z"),
          epochId: testCase.metadata.epochId,
          groupId: testCase.metadata.groupId,
          kind: testCase.metadata.kind,
          nonce: testCase.nonceBase64,
          senderDeviceId: testCase.metadata.senderDeviceId,
        },
        epochKey,
        expectedMetadata: testCase.metadata,
      });

      expect(encodeBase64(decrypted.bytes.expose())).toBe(testCase.plaintextBase64);
      expect(decodeJsonPayload<Record<string, unknown>>(decrypted.bytes)).toEqual(
        JSON.parse(testCase.plaintextJson),
      );
    }
  });

  test("AAD JSON key order is locked byte-for-byte", () => {
    for (const testCase of vectors.cases) {
      expect(testCase.aadJson).toBe(
        JSON.stringify({
          context: vectors.constants.domainContext,
          epochId: testCase.metadata.epochId,
          groupId: testCase.metadata.groupId,
          kind: testCase.metadata.kind,
          purpose: vectors.constants.purpose,
          senderDeviceId: testCase.metadata.senderDeviceId,
        }),
      );
    }
  });
});
