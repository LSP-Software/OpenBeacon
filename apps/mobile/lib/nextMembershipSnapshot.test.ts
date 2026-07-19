import { describe, expect, test } from "bun:test";
import { buildLiveMapMarkers } from "./buildLiveMapMarkers.ts";
import type { LiveMapPosition } from "./mapTrackingTypes.ts";
import { nextMembershipSnapshot } from "./nextMembershipSnapshot.ts";

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

describe("nextMembershipSnapshot", () => {
  test("adopts a successful membership query result", () => {
    expect(
      nextMembershipSnapshot({
        incoming: [{ id: "family", members: [{ userId: "alice" }] }],
        previous: null,
      }),
    ).toEqual([{ id: "family", members: [{ userId: "alice" }] }]);
  });

  test("replaces the previous snapshot when membership changes", () => {
    expect(
      nextMembershipSnapshot({
        incoming: [{ id: "family", members: [{ userId: "alice" }] }],
        previous: [
          {
            id: "family",
            members: [{ userId: "alice" }, { userId: "bob" }],
          },
        ],
      }),
    ).toEqual([{ id: "family", members: [{ userId: "alice" }] }]);
  });

  test("keeps the last known snapshot when the query has no result", () => {
    const previous = [{ id: "family", members: [{ userId: "alice" }] }];

    expect(
      nextMembershipSnapshot({
        incoming: undefined,
        previous,
      }),
    ).toBe(previous);
  });

  test("does not invent membership when there is no prior snapshot", () => {
    expect(
      nextMembershipSnapshot({
        incoming: undefined,
        previous: null,
      }),
    ).toBeNull();
  });

  test("adopts an empty successful snapshot so leavers disappear", () => {
    expect(
      nextMembershipSnapshot({
        incoming: [],
        previous: [{ id: "family", members: [{ userId: "alice" }] }],
      }),
    ).toEqual([]);
  });

  test("query failure without a snapshot does not leak historical senders as markers", () => {
    const groups = nextMembershipSnapshot({
      incoming: undefined,
      previous: null,
    });

    expect(
      buildLiveMapMarkers({
        getGroupColor: () => "#E9C46A",
        groups: groups ?? [],
        positions: [position({ sourceGroupId: "ghost", userId: "mystery" })],
        selfUserId: "alice",
      }),
    ).toEqual([]);
  });

  test("query failure keeps the last known membership for marker filtering", () => {
    const groups = nextMembershipSnapshot({
      incoming: undefined,
      previous: [
        {
          id: "family",
          name: "Family",
          members: [
            { image: null, name: "Alice", userId: "alice" },
            { image: null, name: "Bob", userId: "bob" },
          ],
        },
      ],
    });

    expect(
      buildLiveMapMarkers({
        getGroupColor: () => "#E85D4C",
        groups: groups ?? [],
        positions: [
          position({ sourceGroupId: "family", userId: "alice" }),
          position({ sourceGroupId: "family", userId: "bob" }),
        ],
        selfUserId: "alice",
      }).map((marker) => marker.userId),
    ).toEqual(["alice", "bob"]);
  });
});
