import { describe, expect, test } from "bun:test";
import {
  groupTrackingGetLatestSchema,
  groupTrackingHistoryRangeSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
} from "./tracking.ts";

const validNonce = Buffer.alloc(24, 1).toString("base64");

const validPoint = {
  ciphertext: Buffer.alloc(39, 2).toString("base64"),
  clientPointId: "s1.2:AQIDBAUGBwg=",
  epochId: "epoch-1",
  nonce: validNonce,
  role: "POINT",
  senderDeviceId: "device-1",
} as const;

describe("groupTrackingPointSchema", () => {
  const accepts = (point: object) => groupTrackingPointSchema.safeParse(point).success;

  test("accepts a valid tracking point envelope for each role", () => {
    expect(groupTrackingPointSchema.parse(validPoint)).toEqual(validPoint);
    expect(accepts({ ...validPoint, role: "STAY" })).toBe(true);
    expect(accepts({ ...validPoint, role: "LIVE" })).toBe(true);
    expect(accepts({ ...validPoint, role: "TRAIL" })).toBe(false);
  });

  test("takes only the 52-character canonical base64 of a 39-byte ciphertext", () => {
    expect(validPoint.ciphertext).toHaveLength(52);
    for (const length of [0, 1, 38, 40, 63, 768]) {
      expect(
        accepts({ ...validPoint, ciphertext: Buffer.alloc(length, 2).toString("base64") }),
      ).toBe(false);
    }
    expect(accepts({ ...validPoint, ciphertext: "a".repeat(52) })).toBe(true);
    expect(accepts({ ...validPoint, ciphertext: `${"a".repeat(51)}!` })).toBe(false);
    expect(accepts({ ...validPoint, ciphertext: `${"a".repeat(50)}==` })).toBe(false);
    expect(accepts({ ...validPoint, ciphertext: `${validPoint.ciphertext}\n` })).toBe(false);
  });

  test("takes an optional sharing revision prefix and exactly 8 bytes of point ID", () => {
    expect(accepts({ ...validPoint, clientPointId: "AQIDBAUGBwg=" })).toBe(true);
    expect(accepts({ ...validPoint, clientPointId: "s0.0:AQIDBAUGBwg=" })).toBe(true);
    for (const clientPointId of [
      "AQIDBAUGBw==",
      "AQIDBAUGBwgJ",
      "AQIDBAUGBwh=",
      Buffer.alloc(32, 1).toString("base64"),
      "s1:AQIDBAUGBwg=",
      "s1.2.3:AQIDBAUGBwg=",
      "point-1",
    ]) {
      expect(accepts({ ...validPoint, clientPointId })).toBe(false);
    }
  });

  test("rejects invalid nonce length", () => {
    expect(accepts({ ...validPoint, nonce: Buffer.alloc(12, 1).toString("base64") })).toBe(false);
  });

  test("rejects oversized and noncanonical nonces", () => {
    for (const nonce of [
      `${" ".repeat(1_000_000)}${validNonce}`,
      `${validNonce}\n`,
      "!".repeat(32),
    ]) {
      expect(accepts({ ...validPoint, nonce })).toBe(false);
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

  test("requires a point, a place transition or a place alerts cursor", () => {
    const parse = (batch: object) =>
      groupTrackingUploadBatchSchema.safeParse({ groupId: "group-1", points: [], ...batch })
        .success;
    expect(parse({})).toBe(false);
    expect(parse({ placeTransitions: [] })).toBe(false);
    expect(parse({ placeTransitions: [arrival] })).toBe(true);
    expect(parse({ placeAlertsCursor: null })).toBe(true);
    expect(parse({ placeAlertsCursor: "2026-11-15T10:00:00.000Z|" })).toBe(true);
    expect(parse({ noticesCursor: null })).toBe(true);
    expect(parse({ noticesCursor: "2026-11-15T10:00:00.000Z|" })).toBe(true);
    expect(parse({ noticesCursor: "not a cursor" })).toBe(false);
  });

  test("drops fields it doesn't know, so an older server takes a batch with the notices cursor", () => {
    const parsed = groupTrackingUploadBatchSchema.safeParse({
      groupId: "group-1",
      points: [],
      placeAlertsCursor: null,
      futureCursor: "2026-11-15T10:00:00.000Z|",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ groupId: "group-1", points: [], placeAlertsCursor: null });
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

  test("refuses a cursor date the database can't store", () => {
    const pollFrom = (updatedAt: Date) =>
      groupTrackingPollSchema.safeParse({
        groupId: "group-1",
        cursor: { senderDeviceId: "device-1", updatedAt },
      }).success;
    expect(pollFrom(new Date(-8.64e15))).toBe(false);
    expect(pollFrom(new Date(8.64e15))).toBe(false);
    expect(pollFrom(new Date("2026-11-19T02:00:00.000Z"))).toBe(true);
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

test("history cursors outside PostgreSQL's bigint range are refused instead of failing the query", () => {
  const range = (cursor: { streamId: string; pointId: string }) =>
    groupTrackingHistoryRangeSchema.safeParse({
      groupId: "group",
      fromHour: 0,
      toHour: 1,
      cursor: { capturedHour: 0, ...cursor },
    }).success;
  expect(range({ streamId: "9223372036854775807", pointId: "-9223372036854775808" })).toBe(true);
  expect(range({ streamId: "9999999999999999999", pointId: "1" })).toBe(false);
  expect(range({ streamId: "1", pointId: "9223372036854775808" })).toBe(false);
  expect(range({ streamId: "1", pointId: "-9223372036854775809" })).toBe(false);
});
