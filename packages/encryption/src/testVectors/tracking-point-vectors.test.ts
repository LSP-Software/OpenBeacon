import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { TrackingPoint } from "../index.ts";
import { decodeTrackingPoint, encodeTrackingPoint, TRACKING_POINT_LENGTH } from "../index.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tracking-point-v2.json"), "utf8"),
) as {
  decodeReject: { hex: string; name: string }[];
  encode: { decoded: TrackingPoint; hex: string; name: string; point: TrackingPoint }[];
  encodeReject: { name: string; point: TrackingPoint }[];
  length: number;
  version: number;
};

describe("tracking point vectors", () => {
  test("vector file matches the locked version and length", () => {
    expect(vectors.version).toBe(2);
    expect(vectors.length).toBe(TRACKING_POINT_LENGTH);
    expect(TRACKING_POINT_LENGTH).toBe(23);
  });

  test("encodes each point to the committed bytes", () => {
    for (const testCase of vectors.encode) {
      expect({ name: testCase.name, hex: bytesToHex(encodeTrackingPoint(testCase.point)) }).toEqual(
        { name: testCase.name, hex: testCase.hex },
      );
    }
  });

  test("decodes the committed bytes to the decoded point", () => {
    for (const testCase of vectors.encode) {
      expect({ name: testCase.name, point: decodeTrackingPoint(hexToBytes(testCase.hex)) }).toEqual(
        { name: testCase.name, point: testCase.decoded },
      );
    }
  });

  test("decoding then encoding gives the same bytes", () => {
    for (const testCase of vectors.encode) {
      expect(bytesToHex(encodeTrackingPoint(decodeTrackingPoint(hexToBytes(testCase.hex))))).toBe(
        testCase.hex,
      );
    }
  });

  test("refuses to encode each rejected point", () => {
    for (const testCase of vectors.encodeReject) {
      expect(() => encodeTrackingPoint(testCase.point)).toThrow("Invalid tracking point.");
    }
  });

  test("refuses to decode each rejected payload", () => {
    for (const testCase of vectors.decodeReject) {
      expect(() => decodeTrackingPoint(hexToBytes(testCase.hex))).toThrow(
        "Invalid tracking point.",
      );
    }
  });
});
