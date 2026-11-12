import { describe, expect, test } from "bun:test";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { classifyMapPeople, flagUnreadableMarkers } from "./classifyMapPeople.ts";
import type { MapTrackingStatus } from "./mapTrackingTypes.ts";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");

const member = (userId: string, name = userId) => ({ image: null, name, userId });

const marker = (
  userId: string,
  minutesAgo: number | null,
  isSelf = false,
  deviceId = `${userId}-phone`,
): LiveMapMarker => ({
  battery: null,
  deviceId,
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
  connection: "ok",
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
        isSelf: false,
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
      status: {
        ...loaded,
        undecryptable: [{ deviceId: "josh-phone", groupId: "club", userId: "josh" }],
      },
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
      status: { connection: "failing", groups: {}, membership: "failed", undecryptable: [] },
    });
    expect(sectionsOf(listFailed).waiting).toEqual(["me", "mum"]);
    expect(listFailed.connectionLost).toBe(true);
  });

  test("ignores a failed fetch for a group whose key is missing, since it can't locate anyone", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: new Map([
        ["family", "available"],
        ["club", "missing"],
      ]),
      markers: [marker("me", 0, true)],
      now: NOW,
      selfUserId: "me",
      status: { ...loaded, groups: { family: "loaded", club: "failed" } },
    });

    expect(sectionsOf(people)).toMatchObject({ cantRead: ["josh", "mum"], waiting: [] });
    expect(people.cantRead.map(({ reason }) => reason)).toEqual(["groupKey", "groupKey"]);
  });

  test("still finds people while a key-missing group is on its first fetch", () => {
    const people = classifyMapPeople({
      groups: [club],
      keyAccess: new Map([["club", "missing"]]),
      markers: [],
      now: NOW,
      selfUserId: "me",
      status: { ...loaded, groups: {} },
    });

    expect(sectionsOf(people).finding).toEqual(["josh", "mum"]);
  });

  test("waits rather than calling people missing when their group's key check failed", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: new Map([
        ["family", "available"],
        ["club", "failed"],
      ]),
      markers: [marker("me", 0, true)],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(sectionsOf(people)).toMatchObject({
      cantLocate: [],
      cantRead: [],
      waiting: ["josh", "mum"],
    });
  });

  test("holds the signed-in user in finding like everyone else, then lists them first in can't locate", () => {
    const familyWithZoe = {
      id: "family",
      name: "Family",
      members: [member("me", "Zoe"), member("mum", "Ann")],
    };
    const loading = classifyMapPeople({
      groups: [familyWithZoe],
      keyAccess: available,
      markers: [],
      now: NOW,
      selfUserId: "me",
      status: { ...loaded, groups: {} },
    });
    expect(sectionsOf(loading)).toMatchObject({ cantLocate: [], finding: ["me", "mum"] });

    const settled = classifyMapPeople({
      groups: [familyWithZoe],
      keyAccess: new Map([["family", "missing"]]),
      markers: [],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });
    expect(sectionsOf(settled)).toMatchObject({ cantLocate: ["me"], cantRead: ["mum"] });
    expect(settled.cantLocate[0]).toMatchObject({ isSelf: true, groupNames: ["Family"] });
  });
});

describe("flagUnreadableMarkers", () => {
  test("flags people whose newer point can't be read, but never you", () => {
    const markers = [marker("me", 0, true), marker("mum", 30), marker("josh", 1)];
    const flagged = flagUnreadableMarkers({
      groups: [family, club],
      markers,
      status: {
        ...loaded,
        undecryptable: [
          { deviceId: "mum-phone", groupId: "club", userId: "mum" },
          { deviceId: "me-phone", groupId: "family", userId: "me" },
          { deviceId: "josh-phone", groupId: "family", userId: "josh" },
        ],
      },
    });

    expect(flagged.map((item) => item.unreadableGroup)).toEqual([
      undefined,
      { id: "club", name: "Climbing club" },
      undefined,
    ]);
    expect(flagged[0]).toBe(markers[0]);
    expect(flagged[2]).toBe(markers[2]);
  });
});

describe("classifyMapPeople with several devices", () => {
  test("shows one chip per person using the best status of their devices", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [
        marker("mum", 30, false, "mum-phone"),
        marker("mum", 2, false, "mum-tablet"),
        marker("josh", 40, false, "josh-phone"),
        marker("josh", 20, false, "josh-tablet"),
      ],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(sectionsOf(people)).toMatchObject({ outOfDate: ["josh"], upToDate: ["mum"] });
    expect(people.upToDate.map((item) => item.deviceId)).toEqual(["mum-tablet"]);
    expect(people.outOfDate.map((item) => item.deviceId)).toEqual(["josh-tablet"]);
  });

  test("keeps a person located when only one of their two devices can't be read", () => {
    const status = {
      ...loaded,
      undecryptable: [{ deviceId: "mum-tablet", groupId: "family", userId: "mum" }],
    };
    const markers = flagUnreadableMarkers({
      groups: [family, club],
      markers: [marker("mum", 1, false, "mum-phone")],
      status,
    });
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers,
      now: NOW,
      selfUserId: "me",
      status,
    });

    expect(markers[0]?.unreadableGroup).toBeUndefined();
    expect(sectionsOf(people)).toMatchObject({ cantRead: [], upToDate: ["mum"] });
  });

  test("flags only the device whose newer point can't be read", () => {
    const flagged = flagUnreadableMarkers({
      groups: [family],
      markers: [marker("mum", 1, false, "mum-phone"), marker("mum", 1, false, "mum-tablet")],
      status: {
        ...loaded,
        undecryptable: [{ deviceId: "mum-tablet", groupId: "family", userId: "mum" }],
      },
    });

    expect(flagged.map((item) => item.unreadableGroup)).toEqual([
      undefined,
      { id: "family", name: "Family" },
    ]);
  });

  test("needs attention when the person's only device can't be read", () => {
    const people = classifyMapPeople({
      groups: [family, club],
      keyAccess: available,
      markers: [],
      now: NOW,
      selfUserId: "me",
      status: {
        ...loaded,
        undecryptable: [{ deviceId: "josh-tablet", groupId: "club", userId: "josh" }],
      },
    });

    expect(sectionsOf(people).cantRead).toEqual(["josh"]);
  });

  test("shows you as yourself when only your other device has a location", () => {
    const people = classifyMapPeople({
      groups: [family],
      keyAccess: available,
      markers: [marker("me", 1, false, "me-tablet")],
      now: NOW,
      selfUserId: "me",
      status: loaded,
    });

    expect(people.upToDate.map(({ deviceId, isSelf }) => ({ deviceId, isSelf }))).toEqual([
      { deviceId: "me-tablet", isSelf: true },
    ]);
  });
});

test("paused members have their own ribbon status even when an old pin or missing key exists", () => {
  const people = classifyMapPeople({
    groups: [family],
    keyAccess: new Map(),
    markers: [marker("mum", 0)],
    now: NOW,
    selfUserId: "me",
    status: {
      ...loaded,
      sharing: [
        {
          userId: "mum",
          deviceId: "mum-phone",
          paused: true,
          pausedUntil: null,
          resumeAfter: null,
          revisionPrefix: "s0.1:",
        },
      ],
    },
  });
  expect(people.paused.map((person) => person.userId)).toEqual(["mum"]);
  expect(people.upToDate).toEqual([]);
  expect(people.cantRead).toEqual([]);
});

test("pausing a tablet leaves a member in the normal ribbon section when their phone shares", () => {
  const people = classifyMapPeople({
    groups: [family],
    keyAccess: available,
    markers: [marker("mum", 0), marker("mum", 0, false, "mum-tablet")],
    now: NOW,
    selfUserId: "me",
    status: {
      ...loaded,
      sharing: [
        {
          userId: "mum",
          deviceId: "mum-phone",
          paused: false,
          pausedUntil: null,
          resumeAfter: null,
          revisionPrefix: "",
        },
        {
          userId: "mum",
          deviceId: "mum-tablet",
          paused: true,
          pausedUntil: null,
          resumeAfter: null,
          revisionPrefix: "s0.1:",
        },
      ],
    },
  });
  expect(people.paused).toEqual([]);
  expect(people.upToDate.map((person) => person.deviceId)).toEqual(["mum-phone"]);
});
