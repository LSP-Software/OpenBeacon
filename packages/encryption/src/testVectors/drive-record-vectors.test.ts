import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { DriveRecord } from "../index.ts";
import {
  decodeDriveRecord,
  DRIVE_RECORD_LENGTH,
  DRIVE_RECORD_VERSION,
  driveRecordAssociatedData,
  ENCRYPTED_DRIVE_RECORD_LENGTH,
  encodeDriveRecord,
  EpochKeyMaterial,
  openDriveRecord,
  sealDriveRecord,
} from "../index.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "drive-record-v1.json"), "utf8"),
) as {
  decodeReject: { hex: string; name: string }[];
  encode: { decoded: DriveRecord; hex: string; name: string; record: DriveRecord }[];
  encodeReject: { name: string; record: DriveRecord }[];
  encryptedLength: number;
  length: number;
  sealed: {
    cases: {
      aadJson: string;
      ciphertextBase64: string;
      metadata: { driveId: string; epochId: string; groupId: string; senderDeviceId: string };
      name: string;
      startHour: number;
    }[];
    epochKeyHex: string;
    nonceHex: string;
  };
  version: number;
};

describe("drive record vectors", () => {
  test("vector file matches the locked version and lengths", () => {
    expect(vectors.version).toBe(DRIVE_RECORD_VERSION);
    expect(vectors.length).toBe(DRIVE_RECORD_LENGTH);
    expect(vectors.encryptedLength).toBe(ENCRYPTED_DRIVE_RECORD_LENGTH);
  });

  test("encodes each record to the committed bytes and decodes them back", () => {
    for (const testCase of vectors.encode) {
      expect({ name: testCase.name, hex: bytesToHex(encodeDriveRecord(testCase.record)) }).toEqual({
        name: testCase.name,
        hex: testCase.hex,
      });
      expect(decodeDriveRecord(hexToBytes(testCase.hex))).toEqual(testCase.decoded);
    }
  });

  test("refuses each rejected record and payload", () => {
    for (const testCase of vectors.encodeReject) {
      expect(() => encodeDriveRecord(testCase.record)).toThrow("Invalid drive record.");
    }
    for (const testCase of vectors.decodeReject) {
      expect(() => decodeDriveRecord(hexToBytes(testCase.hex))).toThrow("Invalid drive record.");
    }
  });

  test("seals each record to the committed ciphertext and binds the Drive ID", () => {
    const epochKey = new EpochKeyMaterial(hexToBytes(vectors.sealed.epochKeyHex));
    for (const testCase of vectors.sealed.cases) {
      const record = vectors.encode.find(({ name }) => name === testCase.name)?.record;
      if (!record) throw new Error(`Missing record ${testCase.name}`);
      const sealed = sealDriveRecord({
        ...testCase.metadata,
        epochKey,
        nonce: hexToBytes(vectors.sealed.nonceHex),
        record,
      });
      expect(sealed.ciphertext).toBe(testCase.ciphertextBase64);
      expect(sealed.startHour).toBe(testCase.startHour);
      expect(new TextDecoder().decode(driveRecordAssociatedData(testCase.metadata))).toBe(
        testCase.aadJson,
      );
      expect(openDriveRecord({ ...testCase.metadata, epochKey, sealed })).toEqual(
        decodeDriveRecord(encodeDriveRecord(record)),
      );
    }
  });
});
