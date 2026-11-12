import { describe, expect, test } from "bun:test";
import { applySelfDeviceLocation } from "./applySelfDeviceLocation.ts";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

const marker = (
  overrides: Partial<LiveMapMarker> & Pick<LiveMapMarker, "userId">,
): LiveMapMarker => ({
  battery: { charging: false, level: 80 },
  deviceId: `${overrides.userId}-phone`,
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
  test("ignores API self markers when local GPS is unavailable", () => {
    const alice = marker({
      userId: "alice",
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      battery: { charging: true, level: 55 },
    });
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        lastSentAt: "2026-07-17T12:00:00.000Z",
        markers: [alice, bob],
        selfDeviceLocation: null,
        selfFallback: {
          image: null,
          name: "Alice",
          otherSharedGroupNames: [],
          ringColor: "#2A9D8F",
          sourceGroupId: "family",
        },
        selfDeviceId: "alice-phone",
        selfUserId: "alice",
      }),
    ).toEqual([bob]);
  });

  test("uses the send timestamp with local GPS and omits API battery", () => {
    const aliceFromApi = marker({
      userId: "alice",
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      timestamp: "2026-07-17T12:00:00.000Z",
      battery: { charging: false, level: 80 },
    });
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        lastSentAt: "2026-07-17T12:00:00.000Z",
        markers: [aliceFromApi, bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: {
          image: "https://example.com/a.png",
          name: "Alice Smith",
          otherSharedGroupNames: ["Cousins"],
          ringColor: "#2A9D8F",
          ringColors: ["#2A9D8F", "#E85D4C"],
          sourceGroupId: "family",
        },
        selfDeviceId: "alice-phone",
        selfUserId: "alice",
      }),
    ).toEqual([
      bob,
      {
        battery: null,
        deviceId: "alice-phone",
        image: "https://example.com/a.png",
        initials: "Al",
        isSelf: true,
        latitude: 50.8,
        longitude: -1.1,
        name: "Alice Smith",
        otherSharedGroupNames: ["Cousins"],
        ringColor: "#2A9D8F",
        ringColors: ["#2A9D8F", "#E85D4C"],
        sourceGroupId: "family",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "alice",
      },
    ]);
  });

  test("clears self on permission loss instead of falling back to encrypted self", () => {
    const aliceFromApi = marker({
      userId: "alice",
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      battery: { charging: false, level: 80 },
    });
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });
    const selfFallback = {
      image: null,
      name: "Alice",
      otherSharedGroupNames: [],
      ringColor: "#2A9D8F",
      sourceGroupId: "family",
    };

    const withLocalGps = applySelfDeviceLocation({
      lastSentAt: null,
      markers: [aliceFromApi, bob],
      selfDeviceLocation: {
        latitude: 50.8,
        longitude: -1.1,
        timestamp: "2026-07-17T12:01:00.000Z",
      },
      selfFallback,
      selfDeviceId: "alice-phone",
      selfUserId: "alice",
    });

    expect(withLocalGps.some((entry) => entry.userId === "alice")).toBe(true);

    expect(
      applySelfDeviceLocation({
        lastSentAt: "2026-07-17T12:00:00.000Z",
        markers: [aliceFromApi, bob],
        selfDeviceLocation: null,
        selfFallback,
        selfDeviceId: "alice-phone",
        selfUserId: "alice",
      }),
    ).toEqual([bob]);
  });

  test("leaves other members unaffected when applying local self", () => {
    const bob = marker({
      userId: "bob",
      initials: "Bo",
      name: "Bob",
      latitude: 52.1,
      longitude: -0.5,
      battery: { charging: true, level: 40 },
      timestamp: "2026-07-17T11:59:00.000Z",
    });

    expect(
      applySelfDeviceLocation({
        lastSentAt: null,
        markers: [bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: {
          image: null,
          name: "Alice",
          otherSharedGroupNames: [],
          ringColor: "#2A9D8F",
          sourceGroupId: "family",
        },
        selfDeviceId: "alice-phone",
        selfUserId: "alice",
      }),
    ).toEqual([
      bob,
      {
        battery: null,
        deviceId: "alice-phone",
        image: null,
        initials: "Al",
        isSelf: true,
        latitude: 50.8,
        longitude: -1.1,
        name: "Alice",
        otherSharedGroupNames: [],
        ringColor: "#2A9D8F",
        sourceGroupId: "family",
        timestamp: null,
        userId: "alice",
      },
    ]);
  });

  test("does not show self from local GPS when fallback profile is missing", () => {
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        lastSentAt: "2026-07-17T12:00:00.000Z",
        markers: [bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: null,
        selfDeviceId: "alice-phone",
        selfUserId: "alice",
      }),
    ).toEqual([bob]);
  });

  test("does not show self when selfUserId is empty", () => {
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    expect(
      applySelfDeviceLocation({
        lastSentAt: "2026-07-17T12:00:00.000Z",
        markers: [bob],
        selfDeviceLocation: {
          latitude: 50.8,
          longitude: -1.1,
          timestamp: "2026-07-17T12:01:00.000Z",
        },
        selfFallback: {
          image: null,
          name: "Alice",
          otherSharedGroupNames: [],
          ringColor: "#2A9D8F",
          sourceGroupId: "family",
        },
        selfDeviceId: "",
        selfUserId: "",
      }),
    ).toEqual([bob]);
  });

  test("only replaces this device and keeps the user's other devices", () => {
    const thisPhoneFromApi = marker({ userId: "alice", isSelf: true });
    const tablet = marker({
      deviceId: "alice-tablet",
      latitude: 52.2,
      longitude: 0.12,
      userId: "alice",
    });
    const bob = marker({ userId: "bob", initials: "Bo", name: "Bob" });

    const markers = applySelfDeviceLocation({
      lastSentAt: "2026-07-17T12:00:00.000Z",
      markers: [thisPhoneFromApi, tablet, bob],
      selfDeviceId: "alice-phone",
      selfDeviceLocation: {
        latitude: 50.8,
        longitude: -1.1,
        timestamp: "2026-07-17T12:01:00.000Z",
      },
      selfFallback: {
        image: null,
        name: "Alice",
        otherSharedGroupNames: [],
        ringColor: "#2A9D8F",
        sourceGroupId: "family",
      },
      selfUserId: "alice",
    });

    expect(
      markers.map(({ deviceId, isSelf, latitude }) => ({ deviceId, isSelf, latitude })),
    ).toEqual([
      { deviceId: "alice-tablet", isSelf: false, latitude: 52.2 },
      { deviceId: "bob-phone", isSelf: false, latitude: 51.5 },
      { deviceId: "alice-phone", isSelf: true, latitude: 50.8 },
    ]);
  });
});

test.each(["1", "A"])("preserves the one-character self name %j on the local GPS pin", (name) => {
  const markers = applySelfDeviceLocation({
    lastSentAt: null,
    markers: [],
    selfDeviceLocation: { latitude: 51.5, longitude: -0.12, timestamp: "2026-07-17T12:00:00.000Z" },
    selfFallback: {
      image: null,
      name,
      otherSharedGroupNames: [],
      ringColor: "red",
      sourceGroupId: "family",
    },
    selfDeviceId: "self-phone",
    selfUserId: "self",
  });
  expect(markers[0]?.initials).toBe(name);
});
