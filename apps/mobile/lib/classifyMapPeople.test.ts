import { describe, expect, test } from "bun:test";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { classifyMapPeople } from "./classifyMapPeople.ts";
import type { MapTrackingStatus } from "./mapTrackingTypes.ts";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");

const member = (userId: string, name = userId) => ({ image: null, name, userId });

const marker = (userId: string, minutesAgo: number | null, isSelf = false): LiveMapMarker => ({
  battery: null,
  image: null,
  initials: userId.slice(0, 2),
  isSelf,
  latitude: 51.5,
  longitude: -0.12,
  name: userId,
  otherSharedGroupNames: [],
  ringColor: "#FF1464",
  sourceGroupId: "family",
  timestamp: minutesAgo === null ? null : new Date(NOW - minutesAgo * 60_000).toISOString(),
  userId,
});

const loaded: MapTrackingStatus = {
  groups: { family: "loaded", club: "loaded" },
  membership: "loaded",
  undecryptable: [],
};

const available = new Map([
  ["family", "available" as const],
  ["club", "available" as const],
]);

const family = { id: "family", name: "Family", members: [member("me"), member("mum")] };
const club = { id: "club", name: "Climbing club", members: [member("mum"), member("josh")] };

const sectionsOf = (people: ReturnType<typeof classifyMapPeople>) => ({
  cantLocate: people.cantLocate.map((person) => person.userId),
  cantRead: people.cantRead.map((person) => person.userId),
  finding: people.finding.map((person) => person.userId),
  outOfDate: people.outOfDate.map((person) => person.userId),
  upToDate: people.upToDate.map((person) => person.userId),
  waiting: people.waiting.map((person) => person.userId),
});

describe("classifyMapPeople", () => {
  test("puts each person in exactly one section, once, even across groups", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [marker("me", 0, true)],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(sectionsOf(people)).toEqual({
      cantLocate: ["josh", "mum"],
      cantRead: [],
      finding: [],
      outOfDate: [],
      upToDate: ["me"],
      waiting: [],
    });
    expect(people.cantLocate.find((person) => person.userId === "mum")?.groupNames).toEqual([
      "Family",
      "Climbing club",
    ]);
  });

  test("splits located people at the ten minute out-of-date boundary", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [marker("me", null, true), marker("mum", 11), marker("josh", 9)],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(people.upToDate.map((person) => person.userId)).toEqual(["me", "josh"]);
    expect(people.outOfDate.map((person) => person.userId)).toEqual(["mum"]);
  });

  test("keeps someone located through one group even if another group's key is missing", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: new Map([
        ["family", "available"],
        ["club", "missing"],
      ]),
      markers: [marker("me", 0, true), marker("mum", 1)],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(sectionsOf(people).upToDate).toEqual(["me", "mum"]);
    expect(people.cantRead).toEqual([
      {
        groupId: "club",
        groupName: "Climbing club",
        groupNames: ["Climbing club"],
        image: null,
        initials: "jo",
        name: "josh",
        reason: "groupKey",
        userId: "josh",
      },
    ]);
  });

  test("blames an undecryptable point when the group key is available", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [marker("me", 0, true), marker("mum", 1)],
      now: NOW,
      selfUserId: "me",
      status: { ...loaded, undecryptable: [{ groupId: "club", userId: "josh" }] },
    });

    expect(people.cantRead.map(({ reason, userId }) => ({ reason, userId }))).toEqual([
      { reason: "point", userId: "josh" },
    ]);
  });

  test("holds people in finding until every group they're in has loaded and its key is checked", () => {
    const stillLoading = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [marker("me", 0, true)],
      now: NOW,
      selfUserId: "me",
      status: { ...loaded, groups: { family: "loaded" } },
    });
    expect(sectionsOf(stillLoading).finding).toEqual(["josh", "mum"]);
    expect(stillLoading.cantLocate).toEqual([]);

    const keyUnchecked = classifyMapPeople({
      groups: [family, club],
      keyAccess: new Map([["family", "available"]]),
      markers: [marker("me", 0, true)],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });
    expect(sectionsOf(keyUnchecked).finding).toEqual(["josh", "mum"]);
  });

  test("waits for a connection instead of calling people missing when a fetch failed", () => {
    const groupFailed = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [marker("me", 0, true)],
      now: NOW,
      selfUserId: "me",
      status: { ...loaded, groups: { family: "loaded", club: "failed" } },
    });
    expect(sectionsOf(groupFailed)).toMatchObject({
      cantLocate: [],
      waiting: ["josh", "mum"],
    });

    const listFailed = classifyMapPeople({
      groups: [family],
      keyAccess: available,
      markers: [],
      now: NOW,
      selfUserId: "me",
      status: { groups: {}, membership: "failed", undecryptable: [] },
    });
    expect(sectionsOf(listFailed).waiting).toEqual(["mum"]);
  });

  test("leaves the signed-in user out when they have no marker", () => {
    const people = classifyMapPeople({
      groups: [family],
      keyAccess: available,
      markers: [],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(sectionsOf(people).cantLocate).toEqual(["mum"]);
  });
});
