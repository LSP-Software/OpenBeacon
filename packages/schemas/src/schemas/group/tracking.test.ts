import { describe, expect, test } from "bun:test";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import {
  groupTrackingGetLatestSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
  TRACKING_POINT_KIND,
} from "./tracking.ts";

const validNonce = Buffer.alloc(24, 1).toString("base64");

const validPoint = {
  algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
  ciphertext: "ciphertext",
  clientPointId: "point-1",
  epochId: "epoch-1",
  kind: TRACKING_POINT_KIND,
  nonce: validNonce,
  senderDeviceId: "device-1",
};

describe("groupTrackingPointSchema", () => {
  test("accepts a valid tracking point envelope", () => {
    expect(groupTrackingPointSchema.parse(validPoint)).toEqual(validPoint);
  });

  test("rejects wrong kind", () => {
    expect(() =>
      groupTrackingPointSchema.parse({
        ...validPoint,
        kind: "location",
      }),
    ).toThrow();
  });

  test("limits ciphertext size", () => {
    expect(
      groupTrackingPointSchema.safeParse({ ...validPoint, ciphertext: "a".repeat(1024) }).success,
    ).toBe(true);
    expect(
      groupTrackingPointSchema.safeParse({ ...validPoint, ciphertext: "a".repeat(1025) }).success,
    ).toBe(false);
  });

  test("limits client point IDs", () => {
    expect(
      groupTrackingPointSchema.safeParse({ ...validPoint, clientPointId: "x".repeat(128) }).success,
    ).toBe(true);
    expect(
      groupTrackingPointSchema.safeParse({ ...validPoint, clientPointId: "x".repeat(129) }).success,
    ).toBe(false);
  });

  test("rejects invalid nonce length", () => {
    expect(() =>
      groupTrackingPointSchema.parse({
        ...validPoint,
        nonce: Buffer.alloc(12, 1).toString("base64"),
      }),
    ).toThrow();
  });

  test("rejects oversized and noncanonical nonces", () => {
    for (const nonce of [
      `${" ".repeat(1_000_000)}${validNonce}`,
      `${validNonce}\n`,
      "!".repeat(32),
    ]) {
      expect(groupTrackingPointSchema.safeParse({ ...validPoint, nonce }).success).toBe(false);
    }
  });
});

describe("groupTrackingUploadBatchSchema", () => {
  const arrival = {
    clientId: "2f0c8f5e-4d6b-4b8e-9a51-0d6f3c1b2a77",
    placeId: "place-1",
    direction: "ARRIVE",
    occurredAt: new Date("2026-11-15T10:00:00.000Z"),
    senderDeviceId: "device-1",
  } as const;

  test("requires at least one point or place transition", () => {
    const parse = (batch: object) =>
      groupTrackingUploadBatchSchema.safeParse({ groupId: "group-1", points: [], ...batch })
        .success;
    expect(parse({})).toBe(false);
    expect(parse({ placeTransitions: [] })).toBe(false);
    expect(parse({ placeTransitions: [arrival] })).toBe(true);
  });

  test("refuses repeated or malformed place transitions", () => {
    const parse = (placeTransitions: unknown[]) =>
      groupTrackingUploadBatchSchema.safeParse({ groupId: "group-1", points: [], placeTransitions })
        .success;
    expect(parse([arrival, { ...arrival, direction: "LEAVE" }])).toBe(false);
    expect(parse([{ ...arrival, clientId: "not-a-uuid" }])).toBe(false);
    expect(parse([{ ...arrival, direction: "STAY" }])).toBe(false);
    const tooMany = Array.from({ length: 51 }, () => ({
      ...arrival,
      clientId: crypto.randomUUID(),
    }));
    expect(parse(tooMany)).toBe(false);
  });

  test("only accepts place alert cursors the server could have issued", () => {
    const parse = (placeAlertsCursor: unknown) =>
      groupTrackingUploadBatchSchema.safeParse({
        groupId: "group-1",
        points: [validPoint],
        placeAlertsCursor,
      }).success;
    expect(parse(null)).toBe(true);
    expect(parse("2026-11-15T10:00:00.000Z|")).toBe(true);
    expect(parse("2026-11-15T10:00:00.000Z|01a1e112-8664-7549-a2b4-485385e6b556")).toBe(true);
    expect(parse("2026-13-45T10:00:00.000Z|id")).toBe(false);
    expect(parse("2026-11-15T10:00:00Z|id")).toBe(false);
    expect(parse("2026-11-15T10:00:00.000Z|a|b")).toBe(false);
    expect(parse("")).toBe(false);
  });

  test("accepts a batch of points", () => {
    expect(
      groupTrackingUploadBatchSchema.parse({
        groupId: "group-1",
        points: [validPoint],
      }),
    ).toEqual({
      groupId: "group-1",
      points: [validPoint],
    });
  });
});

describe("groupTrackingPollSchema", () => {
  test("defaults cursor and limit as optional", () => {
    expect(
      groupTrackingPollSchema.parse({
        groupId: "group-1",
      }),
    ).toEqual({
      groupId: "group-1",
    });
  });

  test("rejects limit above 500", () => {
    expect(() =>
      groupTrackingPollSchema.parse({
        groupId: "group-1",
        limit: 501,
      }),
    ).toThrow();
  });
});

describe("groupTrackingGetLatestSchema", () => {
  test("requires groupId", () => {
    expect(groupTrackingGetLatestSchema.parse({ groupId: "group-1" })).toEqual({
      groupId: "group-1",
    });
  });
});
