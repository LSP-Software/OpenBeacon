import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hexToBytes } from "@noble/hashes/utils.js";
import {
  decodeJsonPayload,
  decryptGroupPayload,
  EpochKeyMaterial,
  encodeBase64,
  encodePlaceGeometryV1,
  encryptGroupPayload,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  PLACE_GEOMETRY_KIND,
  validatePlaceGeometryV1,
} from "../index.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "place-geometry-v1.json"), "utf8"),
) as {
  algorithm: string;
  cases: {
    aadJson: string;
    ciphertextBase64: string;
    metadata: { epochId: string; groupId: string; kind: string; senderDeviceId: string };
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

describe("place geometry vectors", () => {
  test("vector file uses the locked algorithm, domain context and kind", () => {
    expect(vectors.version).toBe(1);
    expect(vectors.algorithm).toBe(PAYLOAD_ENCRYPTION_ALGORITHM);
    expect(vectors.constants.domainContext).toBe("openbeacon.group-epoch.v1");
    expect(vectors.constants.purpose).toBe("payload");
    expect(vectors.constants.kind).toBe(PLACE_GEOMETRY_KIND);
    expect(PLACE_GEOMETRY_KIND).toBe("placeGeometry");
  });

  test("vector file's base64 key and nonce match their hex forms", () => {
    expect(encodeBase64(hexToBytes(vectors.constants.epochKeyHex))).toBe(
      vectors.constants.epochKeyBase64,
    );
    expect(encodeBase64(hexToBytes(vectors.constants.nonceHex))).toBe(
      vectors.constants.nonceBase64,
    );
  });

  test("encoding each geometry gives the committed plaintext and ciphertext", () => {
    const epochKey = new EpochKeyMaterial(hexToBytes(vectors.constants.epochKeyHex));

    for (const testCase of vectors.cases) {
      const plaintext = encodePlaceGeometryV1(
        validatePlaceGeometryV1(JSON.parse(testCase.plaintextJson)),
      );
      const encrypted = encryptGroupPayload({
        ...testCase.metadata,
        epochKey,
        nonce: hexToBytes(vectors.constants.nonceHex),
        payload: plaintext,
      });

      expect(plaintext.length).toBe(128);
      expect(new TextDecoder().decode(plaintext)).toBe(testCase.plaintextJson);
      expect(encodeBase64(plaintext)).toBe(testCase.plaintextBase64);
      expect(encrypted.nonce).toBe(testCase.nonceBase64);
      expect(encrypted.ciphertext).toBe(testCase.ciphertextBase64);
    }
  });

  test("decrypting each committed ciphertext gives a valid geometry", () => {
    const epochKey = new EpochKeyMaterial(hexToBytes(vectors.constants.epochKeyHex));

    for (const testCase of vectors.cases) {
      const decrypted = decryptGroupPayload({
        encryptedPayload: {
          ...testCase.metadata,
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: testCase.ciphertextBase64,
          createdAt: new Date("2026-11-15T12:00:00.000Z"),
          nonce: testCase.nonceBase64,
        },
        epochKey,
        expectedMetadata: testCase.metadata,
      });

      expect(validatePlaceGeometryV1(decodeJsonPayload(decrypted.bytes))).toEqual(
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
