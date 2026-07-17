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

  test("rejects invalid nonce length", () => {
    expect(() =>
      groupTrackingPointSchema.parse({
        ...validPoint,
        nonce: Buffer.alloc(12, 1).toString("base64"),
      }),
    ).toThrow();
  });
});

describe("groupTrackingUploadBatchSchema", () => {
  test("requires at least one point", () => {
    expect(() =>
      groupTrackingUploadBatchSchema.parse({
        groupId: "group-1",
        points: [],
      }),
    ).toThrow();
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
