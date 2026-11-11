import { describe, expect, test } from "bun:test";
import { buildLiveMapMarkers, labelDeviceIcons } from "./buildLiveMapMarkers.ts";
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

describe("buildLiveMapMarkers", () => {
  test("builds one marker per live position with ring color from sourceGroupId", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: (groupId) => (groupId === "family" ? "#E85D4C" : "#2A9D8F"),
      groups: [
        {
          id: "family",
          name: "Family",
          members: [
            { image: "https://example.com/a.png", name: "Alice Smith", userId: "alice" },
            { image: null, name: "Bob Jones", userId: "bob" },
          ],
        },
      ],
      positions: [
        position({
          latitude: 51.51,
          longitude: -0.13,
          sourceGroupId: "family",
          userId: "alice",
        }),
        position({
          battery: { charging: true, level: 40 },
          sourceGroupId: "family",
          timestamp: "2026-07-17T12:05:00.000Z",
          userId: "bob",
        }),
      ],
      selfDeviceId: "alice-phone",
    });

    expect(markers).toEqual([
      {
        battery: { charging: false, level: 80 },
        deviceId: "alice-phone",
        image: "https://example.com/a.png",
        initials: "Al",
        isSelf: true,
        latitude: 51.51,
        longitude: -0.13,
        name: "Alice Smith",
        otherSharedGroupNames: [],
        ringColor: "#E85D4C",
        sourceGroupId: "family",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "alice",
      },
      {
        battery: { charging: true, level: 40 },
        deviceId: "bob-phone",
        image: null,
        initials: "Bo",
        isSelf: false,
        latitude: 51.5,
        longitude: -0.12,
        name: "Bob Jones",
        otherSharedGroupNames: [],
        ringColor: "#E85D4C",
        sourceGroupId: "family",
        timestamp: "2026-07-17T12:05:00.000Z",
        userId: "bob",
      },
    ]);
  });

  test("lists other shared group names excluding the source group", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: () => "#457B9D",
      groups: [
        {
          id: "family",
          name: "Family",
          members: [
            { image: null, name: "Alice", userId: "alice" },
            { image: null, name: "Carol", userId: "carol" },
          ],
        },
        {
          id: "hiking",
          name: "Hiking",
          members: [
            { image: null, name: "Alice", userId: "alice" },
            { image: null, name: "Carol", userId: "carol" },
          ],
        },
        {
          id: "work",
          name: "Work",
          members: [{ image: null, name: "Alice", userId: "alice" }],
        },
      ],
      positions: [position({ sourceGroupId: "hiking", userId: "carol" })],
      selfDeviceId: "alice-phone",
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.otherSharedGroupNames).toEqual(["Family"]);
    expect(markers[0]?.ringColor).toBe("#457B9D");
    expect(markers[0]?.sourceGroupId).toBe("hiking");
  });

  test("uses each distinct shared group color once", () => {
    const colors = ["red", "red", "red", "red", "red", "red", "red", "blue"];
    const groups = colors.map((_, index) => ({
      id: String(index),
      name: String(index),
      members: [{ image: null, name: "Alice", userId: "alice" }],
    }));
    const markers = buildLiveMapMarkers({
      getGroupColor: (id) => colors[Number(id)]!,
      groups,
      positions: [position({ sourceGroupId: "0", userId: "alice" })],
      selfDeviceId: "other-phone",
    });
    expect(markers[0]?.ringColors).toEqual(["red", "blue"]);
  });

  test("uses the current shared group color when the location came from a former group", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: (id) => (id === "current" ? "blue" : "red"),
      groups: [
        {
          id: "current",
          name: "Current",
          members: [{ image: null, name: "Alice", userId: "alice" }],
        },
      ],
      positions: [position({ sourceGroupId: "former", userId: "alice" })],
      selfDeviceId: "other-phone",
    });
    expect(markers[0]?.ringColor).toBe("blue");
    expect(markers[0]?.ringColors).toBeUndefined();
  });

  test("returns no markers when there are no positions", () => {
    expect(
      buildLiveMapMarkers({
        getGroupColor: () => "#E85D4C",
        groups: [],
        positions: [],
        selfDeviceId: "alice-phone",
      }),
    ).toEqual([]);
  });

  test("omits senders absent from all current shared memberships", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: () => "#E9C46A",
      groups: [
        {
          id: "family",
          name: "Family",
          members: [{ image: null, name: "Alice", userId: "alice" }],
        },
      ],
      positions: [
        position({ sourceGroupId: "family", userId: "alice" }),
        position({ sourceGroupId: "family", userId: "removed-bob" }),
      ],
      selfDeviceId: "alice-phone",
    });

    expect(markers.map((marker) => marker.userId)).toEqual(["alice"]);
  });

  test("omits positions when membership metadata is stale and sender is not listed", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: () => "#E9C46A",
      groups: [
        {
          id: "family",
          name: "Family",
          members: [{ image: null, name: "Alice", userId: "alice" }],
        },
      ],
      positions: [position({ sourceGroupId: "family", userId: "newly-joined" })],
      selfDeviceId: "alice-phone",
    });

    expect(markers).toEqual([]);
  });

  test("includes a newly added member with their membership metadata", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: () => "#2A9D8F",
      groups: [
        {
          id: "family",
          name: "Family",
          members: [
            { image: null, name: "Alice", userId: "alice" },
            { image: "https://example.com/dana.png", name: "Dana Lee", userId: "dana" },
          ],
        },
      ],
      positions: [position({ sourceGroupId: "family", userId: "dana" })],
      selfDeviceId: "alice-phone",
    });

    expect(markers).toEqual([
      {
        battery: { charging: false, level: 80 },
        deviceId: "dana-phone",
        image: "https://example.com/dana.png",
        initials: "Da",
        isSelf: false,
        latitude: 51.5,
        longitude: -0.12,
        name: "Dana Lee",
        otherSharedGroupNames: [],
        ringColor: "#2A9D8F",
        sourceGroupId: "family",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "dana",
      },
    ]);
  });

  test("marks the current user when they share group membership", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: () => "#E85D4C",
      groups: [
        {
          id: "family",
          name: "Family",
          members: [{ image: null, name: "Alice Smith", userId: "alice" }],
        },
      ],
      positions: [position({ sourceGroupId: "family", userId: "alice" })],
      selfDeviceId: "alice-phone",
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.isSelf).toBe(true);
    expect(markers[0]?.name).toBe("Alice Smith");
  });
});

test("uses the member name from the position's source group", () => {
  const markers = buildLiveMapMarkers({
    getGroupColor: () => "red",
    groups: [
      { id: "first", name: "First", members: [{ userId: "alice", name: "Alice", image: null }] },
      { id: "family", name: "Family", members: [{ userId: "alice", name: "Mum", image: null }] },
    ],
    positions: [position({ userId: "alice", sourceGroupId: "family" })],
    selfDeviceId: "other-phone",
  });
  expect(markers[0]?.name).toBe("Mum");
  expect(markers[0]?.initials).toBe("Mu");
});

test("only marks this device as self and badges people with two or more devices", () => {
  const markers = buildLiveMapMarkers({
    getGroupColor: () => "#E85D4C",
    groups: [
      {
        id: "family",
        name: "Family",
        members: [
          { image: null, name: "Alice", userId: "alice" },
          { image: null, name: "Bob", userId: "bob" },
        ],
      },
    ],
    positions: [
      position({ sourceGroupId: "family", userId: "alice" }),
      position({ deviceId: "alice-tablet", sourceGroupId: "family", userId: "alice" }),
      position({ sourceGroupId: "family", userId: "bob" }),
    ],
    selfDeviceId: "alice-phone",
  });

  expect(markers.map(({ deviceId, isSelf }) => ({ deviceId, isSelf }))).toEqual([
    { deviceId: "alice-phone", isSelf: true },
    { deviceId: "alice-tablet", isSelf: false },
    { deviceId: "bob-phone", isSelf: false },
  ]);

  const labelled = labelDeviceIcons({
    markers,
    memberDevices: [
      { deviceId: "alice-phone", icon: "phone", name: "Pixel 9", userId: "alice" },
      { deviceId: "alice-tablet", icon: "tablet", name: "iPad", userId: "alice" },
      { deviceId: "bob-phone", icon: "phone", name: "Pixel 8", userId: "bob" },
    ],
  });
  expect(labelled.map(({ deviceIcon, deviceName }) => ({ deviceIcon, deviceName }))).toEqual([
    { deviceIcon: "phone", deviceName: "Pixel 9" },
    { deviceIcon: "tablet", deviceName: "iPad" },
    { deviceIcon: undefined, deviceName: undefined },
  ]);
  expect(labelled[2]).toBe(markers[2]);
});
