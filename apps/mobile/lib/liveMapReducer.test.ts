import { describe, expect, test } from "bun:test";
import { reduceLivePositions } from "./liveMapReducer.ts";

const entry = ({
  battery = { charging: false, level: 80 },
  latitude,
  longitude,
  serverCreatedAt,
  serverId,
  sourceGroupId,
  speed = null,
  timestamp,
  userId,
}: {
  battery?: { charging: boolean; level: number };
  latitude: number;
  longitude: number;
  serverCreatedAt: Date;
  serverId: string;
  sourceGroupId: string;
  speed?: number | null;
  timestamp: string;
  userId: string;
}) => ({
  battery,
  latitude,
  longitude,
  serverCreatedAt,
  serverId,
  sourceGroupId,
  speed,
  timestamp,
  userId,
});

describe("reduceLivePositions", () => {
  test("keeps the point with the greatest plaintext timestamp across groups", () => {
    const current = new Map([
      [
        "user-1",
        entry({
          latitude: 51.5,
          longitude: -0.1,
          serverCreatedAt: new Date("2026-07-17T12:00:00.000Z"),
          serverId: "a",
          sourceGroupId: "group-old",
          timestamp: "2026-07-17T12:00:00.000Z",
          userId: "user-1",
        }),
      ],
    ]);

    const next = reduceLivePositions(current, [
      entry({
        latitude: 51.6,
        longitude: -0.2,
        serverCreatedAt: new Date("2026-07-17T11:00:00.000Z"),
        serverId: "b",
        sourceGroupId: "group-new",
        timestamp: "2026-07-17T12:00:01.000Z",
        userId: "user-1",
      }),
    ]);

    expect(next.get("user-1")).toEqual(
      entry({
        latitude: 51.6,
        longitude: -0.2,
        serverCreatedAt: new Date("2026-07-17T11:00:00.000Z"),
        serverId: "b",
        sourceGroupId: "group-new",
        timestamp: "2026-07-17T12:00:01.000Z",
        userId: "user-1",
      }),
    );
  });

  test("rejects a candidate with an older plaintext timestamp", () => {
    const current = new Map([
      [
        "user-1",
        entry({
          latitude: 51.5,
          longitude: -0.1,
          serverCreatedAt: new Date("2026-07-17T12:00:00.000Z"),
          serverId: "a",
          sourceGroupId: "group-a",
          timestamp: "2026-07-17T12:00:00.000Z",
          userId: "user-1",
        }),
      ],
    ]);

    const next = reduceLivePositions(current, [
      entry({
        latitude: 51.6,
        longitude: -0.2,
        serverCreatedAt: new Date("2026-07-17T13:00:00.000Z"),
        serverId: "z",
        sourceGroupId: "group-b",
        timestamp: "2026-07-17T11:59:59.000Z",
        userId: "user-1",
      }),
    ]);

    expect(next.get("user-1")?.sourceGroupId).toBe("group-a");
  });

  test("tie-breaks equal timestamps with greater server createdAt then id", () => {
    const current = new Map([
      [
        "user-1",
        entry({
          latitude: 1,
          longitude: 1,
          serverCreatedAt: new Date("2026-07-17T12:00:00.000Z"),
          serverId: "id-1",
          sourceGroupId: "group-a",
          timestamp: "2026-07-17T12:00:00.000Z",
          userId: "user-1",
        }),
      ],
    ]);

    const byCreatedAt = reduceLivePositions(current, [
      entry({
        latitude: 2,
        longitude: 2,
        serverCreatedAt: new Date("2026-07-17T12:00:01.000Z"),
        serverId: "id-0",
        sourceGroupId: "group-b",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-1",
      }),
    ]);
    expect(byCreatedAt.get("user-1")?.sourceGroupId).toBe("group-b");

    const byId = reduceLivePositions(byCreatedAt, [
      entry({
        latitude: 3,
        longitude: 3,
        serverCreatedAt: new Date("2026-07-17T12:00:01.000Z"),
        serverId: "id-2",
        sourceGroupId: "group-c",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-1",
      }),
    ]);
    expect(byId.get("user-1")?.sourceGroupId).toBe("group-c");
  });

  test("adds a new user without clearing existing markers", () => {
    const current = new Map([
      [
        "user-1",
        entry({
          latitude: 1,
          longitude: 1,
          serverCreatedAt: new Date("2026-07-17T12:00:00.000Z"),
          serverId: "a",
          sourceGroupId: "group-a",
          timestamp: "2026-07-17T12:00:00.000Z",
          userId: "user-1",
        }),
      ],
    ]);

    const next = reduceLivePositions(current, [
      entry({
        latitude: 2,
        longitude: 2,
        serverCreatedAt: new Date("2026-07-17T12:00:00.000Z"),
        serverId: "b",
        sourceGroupId: "group-b",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-2",
      }),
    ]);

    expect([...next.keys()].sort()).toEqual(["user-1", "user-2"]);
  });
});
