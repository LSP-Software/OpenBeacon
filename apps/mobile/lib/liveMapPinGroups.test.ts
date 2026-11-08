import { describe, expect, test } from "bun:test";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import {
  groupLiveMapPins,
  hasSameLiveMapPinGroups,
  liveMapPinTransition,
  liveMapStackExpansionZoom,
} from "./liveMapPinGroups.ts";

const person = (userId: string, latitude: number, longitude: number): LiveMapMarker => ({
  battery: null,
  image: null,
  initials: userId.slice(0, 2),
  isSelf: false,
  latitude,
  longitude,
  name: userId,
  otherSharedGroupNames: [],
  ringColor: "#000000",
  sourceGroupId: "group",
  timestamp: null,
  userId,
});

describe("groupLiveMapPins", () => {
  test("stacks people whose pins would overlap and leaves others alone", () => {
    const groups = groupLiveMapPins({
      zoom: 12,
      markers: [person("a", 52.9, -1.47), person("b", 52.9001, -1.4701), person("c", 53.2, -1.2)],
    });

    expect(groups.map((group) => group.members.map((member) => member.userId))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(groups[0]?.id).toBe("stack:a");
    expect(groups[1]?.id).toBe("c");
  });

  test("splits a stack once zooming in gives each pin room", () => {
    const markers = [person("a", 52.9, -1.47), person("b", 52.901, -1.47)];

    expect(groupLiveMapPins({ zoom: 10, markers })).toHaveLength(1);
    expect(groupLiveMapPins({ zoom: 16, markers })).toHaveLength(2);
  });

  test("keeps every resulting pin clear of its neighbours", () => {
    const markers = Array.from({ length: 10 }, (_, index) =>
      person(`user-${index}`, 52.9 + index * 0.002, -1.47 + index * 0.002),
    );

    const groups = groupLiveMapPins({ zoom: 13, markers });
    for (const first of groups) {
      for (const second of groups) {
        if (first === second) continue;
        const offset = liveMapPinTransition({
          previous: [
            { ...first, id: "stack:parent", members: [first.members[0]!, second.members[0]!] },
          ],
          next: [{ ...second, id: second.id, members: [second.members[0]!] }],
          zoom: 13,
        }).arrivals.get(second.id);
        expect(Math.hypot(offset?.x ?? 99, offset?.y ?? 99)).toBeGreaterThan(30);
      }
    }
  });

  test("does not flicker at the zoom where a stack just splits", () => {
    const markers = [person("a", 52.9, -1.47), person("b", 52.900376, -1.47)];
    const stacked = groupLiveMapPins({ zoom: 15, markers });
    expect(stacked).toHaveLength(1);

    expect(groupLiveMapPins({ zoom: 16, markers, previous: stacked })).toHaveLength(1);
    expect(groupLiveMapPins({ zoom: 16, markers })).toHaveLength(2);
  });
});

describe("liveMapStackExpansionZoom", () => {
  test("zooms just past the level where the stack separates", () => {
    const markers = [person("a", 52.9, -1.47), person("b", 52.905, -1.47)];
    const [group] = groupLiveMapPins({ zoom: 10, markers });

    const zoom = liveMapStackExpansionZoom({ group: group!, zoom: 10 });

    expect(zoom).not.toBeNull();
    expect(groupLiveMapPins({ zoom: zoom!, markers, previous: [group!] })).toHaveLength(2);
  });

  test("returns null when people are together even at street level", () => {
    const markers = [person("a", 52.9, -1.47), person("b", 52.90001, -1.47)];
    const [group] = groupLiveMapPins({ zoom: 10, markers });

    expect(liveMapStackExpansionZoom({ group: group!, zoom: 10 })).toBeNull();
  });
});

describe("liveMapPinTransition", () => {
  const apart = [person("a", 52.9, -1.47), person("b", 52.905, -1.47)];

  test("sends pins towards the stack they are joining", () => {
    const previous = groupLiveMapPins({ zoom: 16, markers: apart });
    const next = groupLiveMapPins({ zoom: 10, markers: apart });

    const { arrivals, gathering } = liveMapPinTransition({ previous, next, zoom: 10 });

    expect(gathering.map(({ marker }) => marker.userId).sort()).toEqual(["a", "b"]);
    expect(gathering[0]!.gatherTo.y * gathering[1]!.gatherTo.y).toBeLessThan(0);
    expect(arrivals.get("stack:a")?.pop).toBe(true);
  });

  test("starts split pins at the stack they came from", () => {
    const previous = groupLiveMapPins({ zoom: 10, markers: apart });
    const next = groupLiveMapPins({ zoom: 16, markers: apart });

    const { arrivals, gathering } = liveMapPinTransition({ previous, next, zoom: 16 });

    expect(gathering).toEqual([]);
    expect(Math.sign(arrivals.get("a")?.y ?? 0)).toBe(-1);
    expect(Math.sign(arrivals.get("b")?.y ?? 0)).toBe(1);
  });
});

describe("hasSameLiveMapPinGroups", () => {
  test("ignores order but notices changed membership", () => {
    const a = person("a", 52.9, -1.47);
    const b = person("b", 53.9, -1.47);
    const separate = groupLiveMapPins({ zoom: 10, markers: [a, b] });
    const reversed = groupLiveMapPins({ zoom: 10, markers: [b, a] });
    const together = groupLiveMapPins({ zoom: 1, markers: [a, b] });

    expect(hasSameLiveMapPinGroups(separate, reversed)).toBe(true);
    expect(hasSameLiveMapPinGroups(separate, together)).toBe(false);
  });
});
