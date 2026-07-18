import { describe, expect, test } from "bun:test";
import { applySelfDeviceLocation } from "./applySelfDeviceLocation.ts";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

const marker = (
  overrides: Partial<LiveMapMarker> & Pick<LiveMapMarker, "userId">,
): LiveMapMarker => ({
  battery: { charging: false, level: 80 },
  image: null,
  initials: "Al",
  isSelf: false,
  latitude: 51.5,
  longitude: -0.12,
  name: "Alice",
  otherSharedGroupNames: [],
  ringColor: "#E85D4C",
  sourceGroupId: "family",
  timestamp: "2026-07-17T12:00:00.000Z",
  ...overrides,
});

describe("applySelfDeviceLocation", () => {
  test("leaves markers unchanged when device location is unavailable", () => {
    const markers = [marker({ userId: "alice", isSelf: true })];

    expect(
      applySelfDeviceLocation({
        markers,
        selfDeviceLocation: null,
        selfFallback: null,
        selfUserId: "alice",
      }),
    ).toEqual(markers);
  });

  test("overrides the self marker coordinates from device location", () => {
    const alice = marker({ userId: "alice", isSelf: true, latitude: 51.5, longitude: -0.12 });
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        markers: [alice, bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: null,
        selfUserId: "alice",
      }),
    ).toEqual([
      {
        ...alice,
        latitude: 50.8,
        longitude: -1.1,
        timestamp: "2026-07-17T12:01:00.000Z",
      },
      bob,
    ]);
  });

  test("leaves markers unchanged when self is missing and no fallback profile exists", () => {
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        markers: [bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: null,
        selfUserId: "alice",
      }),
    ).toEqual([bob]);
  });

  test("inserts a self marker from device location when poll has no self point yet", () => {
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        markers: [bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: {
          image: "https://example.com/a.png",
          name: "Alice Smith",
          otherSharedGroupNames: [],
          ringColor: "#2A9D8F",
          sourceGroupId: "family",
        },
        selfUserId: "alice",
      }),
    ).toEqual([
      bob,
      {
        battery: null,
        image: "https://example.com/a.png",
        initials: "Al",
        isSelf: true,
        latitude: 50.8,
        longitude: -1.1,
        name: "Alice Smith",
        otherSharedGroupNames: [],
        ringColor: "#2A9D8F",
        sourceGroupId: "family",
        timestamp: "2026-07-17T12:01:00.000Z",
        userId: "alice",
      },
    ]);
  });
});
