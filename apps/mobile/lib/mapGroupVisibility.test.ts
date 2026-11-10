import { describe, expect, test } from "bun:test";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { classifyMapPeople } from "./classifyMapPeople.ts";
import {
  canHideMapGroups,
  hideMapGroupMarkers,
  listHiddenMapPeople,
  resolveHiddenGroupIds,
  shownMapGroups,
} from "./mapGroupVisibility.ts";

const COLORS: Record<string, string> = { family: "#FF1464", club: "#2A9D8F", gran: "#9B5DE5" };
const getGroupColor = (groupId: string) => COLORS[groupId] ?? "#000000";

const member = (userId: string, name = userId) => ({ image: null, name, userId });
const family = { id: "family", name: "Family", members: [member("me"), member("mum")] };
const club = {
  id: "club",
  name: "Climbing club",
  members: [member("me"), member("mum"), member("tom", "Tom"), member("ben", "Ben")],
};
const gran = { id: "gran", name: "Grandparents", members: [member("me"), member("tom", "Tom")] };

const marker = (userId: string, ringColors: string[], isSelf = false): LiveMapMarker => ({
  battery: null,
  image: null,
  initials: userId.slice(0, 2),
  isSelf,
  latitude: 51.5,
  longitude: -0.12,
  name: userId,
  otherSharedGroupNames: [],
  ringColor: ringColors[0] ?? "#FF1464",
  ...(ringColors.length > 1 ? { ringColors } : {}),
  sourceGroupId: "club",
  timestamp: null,
  userId,
});

describe("canHideMapGroups", () => {
  test("needs at least two groups", () => {
    expect(canHideMapGroups(0)).toBe(false);
    expect(canHideMapGroups(1)).toBe(false);
    expect(canHideMapGroups(2)).toBe(true);
  });
});

describe("resolveHiddenGroupIds", () => {
  test("keeps stored ids for groups the person is still in", () => {
    expect([...resolveHiddenGroupIds([family, club], ["club", "left-group"])]).toEqual(["club"]);
  });

  test("ignores hidden groups when the person is in fewer than two groups", () => {
    expect(resolveHiddenGroupIds([club], ["club"]).size).toBe(0);
  });
});

describe("hideMapGroupMarkers", () => {
  const markers = [
    marker("me", ["#FF1464", "#2A9D8F", "#9B5DE5"], true),
    marker("mum", ["#FF1464", "#2A9D8F"]),
    marker("tom", ["#2A9D8F", "#9B5DE5"]),
    marker("ben", ["#2A9D8F"]),
  ];

  test("returns the same markers when nothing is hidden", () => {
    expect(
      hideMapGroupMarkers({
        getGroupColor,
        groups: [family, club, gran],
        hiddenGroupIds: new Set(),
        markers,
        selfUserId: "me",
      }),
    ).toBe(markers);
  });

  test("keeps people in any shown group and drops their hidden group's colour", () => {
    const result = hideMapGroupMarkers({
      getGroupColor,
      groups: [family, club, gran],
      hiddenGroupIds: new Set(["club"]),
      markers,
      selfUserId: "me",
    });

    expect(result.map((item) => item.userId)).toEqual(["me", "mum", "tom"]);
    const [self, mum, tom] = result;
    expect(self?.ringColors).toEqual(["#FF1464", "#9B5DE5"]);
    expect(mum?.ringColor).toBe("#FF1464");
    expect(mum && "ringColors" in mum).toBe(false);
    expect(tom?.ringColor).toBe("#9B5DE5");
  });

  test("leaves people with no hidden group untouched", () => {
    const result = hideMapGroupMarkers({
      getGroupColor,
      groups: [family, club, gran],
      hiddenGroupIds: new Set(["family"]),
      markers,
      selfUserId: "me",
    });

    expect(result[2]).toBe(markers[2]);
    expect(result[3]).toBe(markers[3]);
  });

  test("keeps the ring colour of a shown source group", () => {
    const [result] = hideMapGroupMarkers({
      getGroupColor,
      groups: [family, club, gran],
      hiddenGroupIds: new Set(["family"]),
      markers: [marker("me", ["#FF1464", "#2A9D8F", "#9B5DE5"], true)],
      selfUserId: "me",
    });

    expect(result?.ringColor).toBe("#2A9D8F");
    expect(result?.ringColors).toEqual(["#2A9D8F", "#9B5DE5"]);
  });

  test("drops hidden group names from the groups the person is also in", () => {
    const [result] = hideMapGroupMarkers({
      getGroupColor,
      groups: [family, club, gran],
      hiddenGroupIds: new Set(["club"]),
      markers: [
        {
          ...marker("tom", ["#2A9D8F", "#9B5DE5"]),
          otherSharedGroupNames: ["Climbing club", "Grandparents"],
          sourceGroupId: "family",
        },
      ],
      selfUserId: "me",
    });

    expect(result?.otherSharedGroupNames).toEqual(["Grandparents"]);
  });

  test("always keeps you, with your original ring, when every group is hidden", () => {
    const result = hideMapGroupMarkers({
      getGroupColor,
      groups: [family, club, gran],
      hiddenGroupIds: new Set(["family", "club", "gran"]),
      markers,
      selfUserId: "me",
    });

    expect(result).toEqual(markers.slice(0, 1));
  });
});

describe("listHiddenMapPeople", () => {
  test("lists people who are only in hidden groups, by name", () => {
    expect(
      listHiddenMapPeople({
        groups: [family, club, gran],
        hiddenGroupIds: new Set(["club", "gran"]),
        selfUserId: "me",
      }),
    ).toEqual([
      {
        groupNames: ["Climbing club"],
        hiddenGroups: [{ id: "club", name: "Climbing club" }],
        image: null,
        initials: "Be",
        isSelf: false,
        name: "Ben",
        userId: "ben",
      },
      {
        groupNames: ["Climbing club", "Grandparents"],
        hiddenGroups: [
          { id: "club", name: "Climbing club" },
          { id: "gran", name: "Grandparents" },
        ],
        image: null,
        initials: "To",
        isSelf: false,
        name: "Tom",
        userId: "tom",
      },
    ]);
  });

  test("never lists you, even when every group is hidden", () => {
    const hidden = listHiddenMapPeople({
      groups: [family, club],
      hiddenGroupIds: new Set(["family", "club"]),
      selfUserId: "me",
    });

    expect(hidden.map((item) => item.userId)).toEqual(["ben", "mum", "tom"]);
  });
});

describe("shownMapGroups", () => {
  test("leaves out hidden groups", () => {
    expect(
      shownMapGroups({
        groups: [family, club, gran],
        hiddenGroupIds: new Set(["club"]),
        selfUserId: "me",
      }),
    ).toEqual([family, gran]);
  });

  test("keeps only you when every group is hidden", () => {
    expect(
      shownMapGroups({
        groups: [family, club],
        hiddenGroupIds: new Set(["family", "club"]),
        selfUserId: "me",
      }),
    ).toEqual([
      { ...family, members: [member("me")] },
      { ...club, members: [member("me")] },
    ]);
  });

  test("keeps a hidden group's problems away from people shown through another group", () => {
    const people = classifyMapPeople({
      groups: shownMapGroups({
        groups: [family, club, gran],
        hiddenGroupIds: new Set(["club"]),
        selfUserId: "me",
      }),
      keyAccess: new Map([
        ["family", "available"],
        ["club", "missing"],
        ["gran", "available"],
      ]),
      markers: [],
      now: 0,
      selfUserId: "me",
      status: {
        connection: "ok",
        groups: { family: "loaded", gran: "loaded" },
        membership: "loaded",
        undecryptable: [{ groupId: "club", userId: "mum" }],
      },
    });

    expect(people.cantRead).toEqual([]);
    expect(people.finding).toEqual([]);
    expect(people.cantLocate.map((item) => item.userId)).toEqual(["me", "mum", "tom"]);
  });

  test("keeps you on the people list when every group is hidden", () => {
    const people = classifyMapPeople({
      groups: shownMapGroups({
        groups: [family, club],
        hiddenGroupIds: new Set(["family", "club"]),
        selfUserId: "me",
      }),
      keyAccess: new Map([
        ["family", "available"],
        ["club", "available"],
      ]),
      markers: [],
      now: 0,
      selfUserId: "me",
      status: {
        connection: "ok",
        groups: { club: "loaded", family: "loaded" },
        membership: "loaded",
        undecryptable: [],
      },
    });

    expect(people.cantLocate.map((item) => item.userId)).toEqual(["me"]);
  });
});
