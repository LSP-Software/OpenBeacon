import { describe, expect, test } from "bun:test";
import { buildLiveMapMarkers } from "./buildLiveMapMarkers.ts";
import type { LiveMapPosition } from "./mapTrackingTypes.ts";

const position = (
  overrides: Partial<LiveMapPosition> & Pick<LiveMapPosition, "userId" | "sourceGroupId">,
): LiveMapPosition => ({
  battery: { charging: false, level: 80 },
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
            { id: "alice", image: "https://example.com/a.png", name: "Alice Smith" },
            { id: "bob", image: null, name: "Bob Jones" },
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
      selfUserId: "alice",
    });

    expect(markers).toEqual([
      {
        battery: { charging: false, level: 80 },
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
            { id: "alice", image: null, name: "Alice" },
            { id: "carol", image: null, name: "Carol" },
          ],
        },
        {
          id: "hiking",
          name: "Hiking",
          members: [
            { id: "alice", image: null, name: "Alice" },
            { id: "carol", image: null, name: "Carol" },
          ],
        },
        {
          id: "work",
          name: "Work",
          members: [{ id: "alice", image: null, name: "Alice" }],
        },
      ],
      positions: [position({ sourceGroupId: "hiking", userId: "carol" })],
      selfUserId: "alice",
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.otherSharedGroupNames).toEqual(["Family"]);
    expect(markers[0]?.ringColor).toBe("#457B9D");
    expect(markers[0]?.sourceGroupId).toBe("hiking");
  });

  test("returns no markers when there are no positions", () => {
    expect(
      buildLiveMapMarkers({
        getGroupColor: () => "#E85D4C",
        groups: [],
        positions: [],
        selfUserId: "alice",
      }),
    ).toEqual([]);
  });

  test("falls back to Unknown and two-letter initials when member metadata is missing", () => {
    const markers = buildLiveMapMarkers({
      getGroupColor: () => "#E9C46A",
      groups: [],
      positions: [position({ sourceGroupId: "ghost", userId: "mystery" })],
      selfUserId: "alice",
    });

    expect(markers).toEqual([
      {
        battery: { charging: false, level: 80 },
        image: null,
        initials: "Un",
        isSelf: false,
        latitude: 51.5,
        longitude: -0.12,
        name: "Unknown",
        otherSharedGroupNames: [],
        ringColor: "#E9C46A",
        sourceGroupId: "ghost",
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "mystery",
      },
    ]);
  });
});
