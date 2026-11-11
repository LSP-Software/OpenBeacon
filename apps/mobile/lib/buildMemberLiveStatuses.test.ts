import { describe, expect, test } from "bun:test";
import { buildMemberLiveStatuses } from "./buildMemberLiveStatuses.ts";
import type { LiveMapPosition } from "./mapTrackingTypes.ts";

const position = (
  overrides: Partial<LiveMapPosition> & Pick<LiveMapPosition, "userId" | "sourceGroupId">,
): LiveMapPosition => ({
  battery: { charging: false, level: 80 },
  deviceId: `${overrides.userId}-phone`,
  latitude: 51.5,
  longitude: -0.12,
  speed: null,
  timestamp: "2026-07-17T12:00:00.000Z",
  ...overrides,
});

describe("buildMemberLiveStatuses", () => {
  test("attaches live battery and timestamp to matching members", () => {
    const statuses = buildMemberLiveStatuses({
      members: [
        {
          id: "membership-alice",
          role: "OWNER",
          user: { id: "alice", image: "https://example.com/a.png", name: "Alice Smith" },
        },
        {
          id: "membership-bob",
          role: "MEMBER",
          user: { id: "bob", image: null, name: "Bob Jones" },
        },
      ],
      positions: [
        position({
          battery: { charging: true, level: 42 },
          sourceGroupId: "family",
          timestamp: "2026-07-17T12:05:00.000Z",
          userId: "bob",
        }),
      ],
    });

    expect(statuses).toEqual([
      {
        activeDeviceCount: 0,
        battery: null,
        devices: [],
        nickname: null,
        id: "membership-alice",
        role: "OWNER",
        timestamp: null,
        user: { id: "alice", image: "https://example.com/a.png", name: "Alice Smith" },
      },
      {
        activeDeviceCount: 0,
        battery: { charging: true, level: 42 },
        devices: [
          {
            battery: { charging: true, level: 42 },
            deviceId: "bob-phone",
            icon: null,
            name: null,
            platform: null,
            timestamp: "2026-07-17T12:05:00.000Z",
          },
        ],
        nickname: null,
        id: "membership-bob",
        role: "MEMBER",
        timestamp: "2026-07-17T12:05:00.000Z",
        user: { id: "bob", image: null, name: "Bob Jones" },
      },
    ]);
  });

  test("ignores live positions for users not in the roster", () => {
    const statuses = buildMemberLiveStatuses({
      members: [
        {
          id: "membership-alice",
          role: "OWNER",
          user: { id: "alice", image: null, name: "Alice" },
        },
      ],
      positions: [position({ sourceGroupId: "family", userId: "carol" })],
    });

    expect(statuses).toEqual([
      {
        activeDeviceCount: 0,
        battery: null,
        devices: [],
        nickname: null,
        id: "membership-alice",
        role: "OWNER",
        timestamp: null,
        user: { id: "alice", image: null, name: "Alice" },
      },
    ]);
  });

  test("keeps roster order when merging live positions", () => {
    const statuses = buildMemberLiveStatuses({
      members: [
        {
          id: "membership-bob",
          role: "MEMBER",
          user: { id: "bob", image: null, name: "Bob" },
        },
        {
          id: "membership-alice",
          role: "OWNER",
          user: { id: "alice", image: null, name: "Alice" },
        },
      ],
      positions: [
        position({ sourceGroupId: "family", userId: "alice" }),
        position({
          battery: { charging: false, level: 10 },
          sourceGroupId: "family",
          userId: "bob",
        }),
      ],
    });

    expect(statuses.map((status) => status.user.id)).toEqual(["bob", "alice"]);
    expect(statuses[0]?.battery).toEqual({ charging: false, level: 10 });
    expect(statuses[1]?.timestamp).toBe("2026-07-17T12:00:00.000Z");
  });

  test("lists each device newest first and shows the newest one for the person", () => {
    const [alice] = buildMemberLiveStatuses({
      memberDevices: [
        {
          deviceId: "alice-phone",
          icon: "phone",
          name: "Pixel 9",
          platform: "android",
          userId: "alice",
        },
        {
          deviceId: "alice-tablet",
          icon: "tablet",
          name: "iPad",
          platform: "ios",
          userId: "alice",
        },
      ],
      members: [
        {
          id: "membership-alice",
          role: "OWNER",
          user: { id: "alice", image: null, name: "Alice" },
        },
      ],
      positions: [
        position({
          battery: { charging: false, level: 15 },
          sourceGroupId: "family",
          timestamp: "2026-07-17T12:00:00.000Z",
          userId: "alice",
        }),
        position({
          battery: { charging: true, level: 90 },
          deviceId: "alice-tablet",
          sourceGroupId: "family",
          timestamp: "2026-07-17T12:10:00.000Z",
          userId: "alice",
        }),
      ],
    });

    expect(alice?.activeDeviceCount).toBe(2);
    expect(alice?.battery).toEqual({ charging: true, level: 90 });
    expect(alice?.timestamp).toBe("2026-07-17T12:10:00.000Z");
    expect(alice?.devices.map(({ battery, name }) => ({ level: battery.level, name }))).toEqual([
      { level: 90, name: "iPad" },
      { level: 15, name: "Pixel 9" },
    ]);
  });
});
