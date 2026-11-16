import { describe, expect, test } from "bun:test";
import { dropInactiveDevices, reduceLivePositions } from "./liveMapReducer.ts";

const entry = ({
  battery = { charging: false, level: 80 },
  deviceId,
  latitude,
  longitude,
  serverUpdatedAt,
  sourceGroupId,
  speed = null,
  timestamp,
  userId,
}: {
  battery?: { charging: boolean; level: number };
  deviceId?: string;
  latitude: number;
  longitude: number;
  serverUpdatedAt: Date;
  sourceGroupId: string;
  speed?: number | null;
  timestamp: string;
  userId: string;
}) => ({
  battery,
  deviceId: deviceId ?? userId,
  latitude,
  longitude,
  serverUpdatedAt,
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
          serverUpdatedAt: new Date("2026-07-17T12:00:00.000Z"),
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
        serverUpdatedAt: new Date("2026-07-17T11:00:00.000Z"),
        sourceGroupId: "group-new",
        timestamp: "2026-07-17T12:00:01.000Z",
        userId: "user-1",
      }),
    ]);

    expect(next.get("user-1")).toEqual(
      entry({
        latitude: 51.6,
        longitude: -0.2,
        serverUpdatedAt: new Date("2026-07-17T11:00:00.000Z"),
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
          serverUpdatedAt: new Date("2026-07-17T12:00:00.000Z"),
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
        serverUpdatedAt: new Date("2026-07-17T13:00:00.000Z"),
        sourceGroupId: "group-b",
        timestamp: "2026-07-17T11:59:59.000Z",
        userId: "user-1",
      }),
    ]);

    expect(next.get("user-1")?.sourceGroupId).toBe("group-a");
  });

  test("tie-breaks equal timestamps with the later server update", () => {
    const current = new Map([
      [
        "user-1",
        entry({
          latitude: 1,
          longitude: 1,
          serverUpdatedAt: new Date("2026-07-17T12:00:00.000Z"),
          sourceGroupId: "group-a",
          timestamp: "2026-07-17T12:00:00.000Z",
          userId: "user-1",
        }),
      ],
    ]);

    const later = reduceLivePositions(current, [
      entry({
        latitude: 2,
        longitude: 2,
        serverUpdatedAt: new Date("2026-07-17T12:00:01.000Z"),
        sourceGroupId: "group-b",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-1",
      }),
    ]);
    expect(later.get("user-1")?.sourceGroupId).toBe("group-b");

    const same = reduceLivePositions(later, [
      entry({
        latitude: 3,
        longitude: 3,
        serverUpdatedAt: new Date("2026-07-17T12:00:01.000Z"),
        sourceGroupId: "group-c",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-1",
      }),
    ]);
    expect(same.get("user-1")?.sourceGroupId).toBe("group-b");
  });

  test("adds a new user without clearing existing markers", () => {
    const current = new Map([
      [
        "user-1",
        entry({
          latitude: 1,
          longitude: 1,
          serverUpdatedAt: new Date("2026-07-17T12:00:00.000Z"),
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
        serverUpdatedAt: new Date("2026-07-17T12:00:00.000Z"),
        sourceGroupId: "group-b",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-2",
      }),
    ]);

    expect([...next.keys()].sort()).toEqual(["user-1", "user-2"]);
  });

  test("keeps two devices of one user apart", () => {
    const phone = entry({
      battery: { charging: false, level: 20 },
      deviceId: "phone",
      latitude: 51.5,
      longitude: -0.1,
      serverUpdatedAt: new Date("2026-07-17T12:05:00.000Z"),
      sourceGroupId: "group-a",
      timestamp: "2026-07-17T12:05:00.000Z",
      userId: "user-1",
    });
    const tablet = entry({
      battery: { charging: true, level: 90 },
      deviceId: "tablet",
      latitude: 52.2,
      longitude: 0.1,
      serverUpdatedAt: new Date("2026-07-17T12:00:00.000Z"),
      sourceGroupId: "group-a",
      timestamp: "2026-07-17T12:00:00.000Z",
      userId: "user-1",
    });

    const next = reduceLivePositions(new Map(), [phone, tablet]);
    const again = reduceLivePositions(next, [tablet, phone]);

    expect(next.get("phone")).toEqual(phone);
    expect(next.get("tablet")).toEqual(tablet);
    expect(again).toEqual(next);
  });
});

describe("dropInactiveDevices", () => {
  const devicePin = (deviceId: string, timestamp: string) =>
    entry({
      deviceId,
      latitude: 51.5,
      longitude: -0.1,
      serverUpdatedAt: new Date(timestamp),
      sourceGroupId: "group-a",
      timestamp,
      userId: "user-1",
    });

  test("drops removed devices and keeps active ones however old their last point is", () => {
    const removed = devicePin("removed", "2026-07-17T12:00:00.000Z");
    const quiet = devicePin("quiet", "2026-05-01T08:00:00.000Z");
    const current = new Map([
      ["removed", removed],
      ["quiet", quiet],
    ]);

    const next = dropInactiveDevices(current, {
      activeDeviceIds: new Set(["quiet"]),
      seenAtRequest: current,
    });

    expect([...next.keys()]).toEqual(["quiet"]);
    expect(next.get("quiet")).toBe(quiet);
  });

  test("keeps a device whose point arrived after the authoritative view was requested", () => {
    const before = new Map([["old", devicePin("old", "2026-07-17T12:00:00.000Z")]]);
    const arrived = devicePin("new", "2026-07-17T12:01:00.000Z");
    const updated = devicePin("old", "2026-07-17T12:02:00.000Z");
    const current = new Map([
      ["old", updated],
      ["new", arrived],
    ]);

    const next = dropInactiveDevices(current, {
      activeDeviceIds: new Set(),
      seenAtRequest: before,
    });

    expect(next).toEqual(current);
  });

  test("returns the same map when nothing is dropped", () => {
    const current = new Map([["phone", devicePin("phone", "2026-07-17T12:00:00.000Z")]]);

    expect(
      dropInactiveDevices(current, { activeDeviceIds: new Set(["phone"]), seenAtRequest: current }),
    ).toBe(current);
  });
});
