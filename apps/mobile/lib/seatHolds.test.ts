import { beforeEach, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const storageValues = new Map<string, string>();
const shown: Array<{ title: string; body: string | null; kind: string }> = [];
const nativeNotices: Array<{ names: Record<string, string>; held: string[] }> = [];
const nativeHeldGroupIds: string[][] = [];
let nativeHeld: string[] = [];
let nativeOwnerMatches = true;
const cachedGroups: unknown[] = [];
let paused = false;
let listQueries = 0;
let groups = [
  { id: "family", name: "Family", members: [{ id: "m1" }] },
  { id: "work", name: "Work", members: [{ id: "m2" }] },
];
let noticeApplied = true;
let checkedMembership: string | null = null;
let checkedNames: string | null = null;

mock.module("react-native", () => createReactNativeTestModule({ platformOS: "android" }));
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
    getAllKeys: () => [...storageValues.keys()],
    remove: (key: string) => {
      storageValues.delete(key);
    },
  },
}));
mock.module("./currentServer.ts", () => ({ baseUrl: "https://api.example.test" }));
mock.module("./api.ts", () => ({
  queryClient: {
    setQueryData: (_key: unknown, data: unknown) => {
      cachedGroups.push(data);
    },
  },
  trpc: { groupMembership: { list: { queryKey: () => ["groups"] } } },
  trpcClient: {
    groupMembership: {
      list: {
        query: async () => {
          listQueries += 1;
          return groups;
        },
      },
    },
  },
}));
mock.module("./locationSharing.ts", () => ({ hasLocallyPausedSharing: () => paused }));
mock.module("./notifications.ts", () => ({
  showEventNotice: async (notice: { title: string; body: string | null; kind: string }) => {
    shown.push({ title: notice.title, body: notice.body, kind: notice.kind });
    return true;
  },
}));
mock.module("./trackingModule.ts", () => ({
  loadTrackingModule: async () => ({
    seatHoldGroupIds: () => (nativeOwnerMatches ? nativeHeld : null),
    setSeatHoldNotice: (
      _owner: string,
      _deviceId: string,
      names: Record<string, string>,
      heldGroupIds: string[],
    ) => {
      if (!noticeApplied) return false;
      nativeNotices.push({ names, held: heldGroupIds });
      nativeHeldGroupIds.push(heldGroupIds);
      nativeHeld = heldGroupIds;
      return true;
    },
    clearSeatHoldNotices: () => {
      nativeHeld = [];
    },
  }),
}));
mock.module("./trackingKeyCheck.ts", () => ({
  getCheckedMembership: () => checkedMembership,
  getCheckedGroupNames: () => checkedNames,
  getGroupNamesSignature: (list: { id: string; name: string }[]) =>
    list.map((group) => `${group.id}:${group.name}`).join("|"),
  getMembershipSignature: (list: { id: string; members: { id: string }[] }[]) =>
    list
      .map((group) => `${group.id}:${group.members.map((member) => member.id).join(",")}`)
      .join("|"),
}));

const { clearSeatHolds, forgetSeatHoldGroupNames, noteHeldGroups } = await import("./seatHolds.ts");

const note = (heldGroupIds: string[]) =>
  noteHeldGroups({ deviceId: "phone", heldGroupIds, userId: "sam" });

beforeEach(() => {
  storageValues.clear();
  shown.length = 0;
  nativeNotices.length = 0;
  nativeHeldGroupIds.length = 0;
  nativeHeld = [];
  nativeOwnerMatches = true;
  cachedGroups.length = 0;
  paused = false;
  listQueries = 0;
  groups = [
    { id: "family", name: "Family", members: [{ id: "m1" }] },
    { id: "work", name: "Work", members: [{ id: "m2" }] },
  ];
  noticeApplied = true;
  checkedMembership = null;
  checkedNames = null;
});

const familyAndWork = { family: "Family", work: "Work" };

test("the phone gets every group's name and the groups on hold", async () => {
  await note(["work"]);
  expect(nativeNotices).toEqual([{ names: familyAndWork, held: ["work"] }]);
  expect(shown).toEqual([]);

  await note(["work"]);
  expect(nativeNotices).toHaveLength(1);
  expect(shown).toEqual([]);

  await note(["family", "work"]);
  expect(nativeNotices.at(-1)).toEqual({ names: familyAndWork, held: ["family", "work"] });
});

test("the phone is told which groups to stop recording for until the hold lifts", async () => {
  await note(["work"]);
  await note(["family", "work"]);
  await note([]);
  expect(nativeHeldGroupIds).toEqual([["work"], ["family", "work"], []]);
});

test("a held group the phone hasn't listed yet still stops recording", async () => {
  await note(["club"]);
  expect(nativeNotices).toEqual([{ names: familyAndWork, held: ["club"] }]);
});

test("a phone that has never been on hold doesn't touch the notice", async () => {
  await note([]);
  await note([]);
  expect(nativeNotices).toEqual([]);
  expect(listQueries).toBe(0);
});

test("a lifted hold says the group is active again", async () => {
  await note(["family", "work"]);
  await note(["work"]);
  expect(shown).toEqual([
    {
      title: "Family is active again",
      body: "This phone is sharing its location with the group again.",
      kind: "accountAlert",
    },
  ]);
  expect(nativeNotices.at(-1)).toEqual({ names: familyAndWork, held: ["work"] });
});

test("a lifted hold never resumes a pause the person chose", async () => {
  await note(["family"]);
  paused = true;
  await note([]);
  expect(shown).toEqual([
    {
      title: "Family is active again",
      body: "Your location sharing stays paused until you turn it back on.",
      kind: "accountAlert",
    },
  ]);
});

test("an unchanged hold doesn't fetch the group list again", async () => {
  await note(["work"]);
  await note(["work"]);
  await note(["work"]);
  expect(listQueries).toBe(1);
  await note([]);
  await note([]);
  expect(listQueries).toBe(2);
});

test("the fetched group list fills the cache instead of being fetched twice", async () => {
  await note(["work"]);
  expect(cachedGroups).toEqual([groups]);
});

test("a membership change refreshes the notice for an unchanged hold", async () => {
  await note(["work"]);
  checkedMembership = "family:m1|work:m2";
  await note(["work"]);
  expect(listQueries).toBe(1);
  groups = [...groups, { id: "club", name: "Club", members: [{ id: "m3" }] }];
  checkedMembership = "club:m3|family:m1|work:m2";
  await note(["work"]);
  expect(listQueries).toBe(2);
  expect(nativeNotices.at(-1)).toEqual({
    names: { ...familyAndWork, club: "Club" },
    held: ["work"],
  });
});

test("a renamed group refreshes the names in the notice", async () => {
  await note(["work"]);
  checkedNames = "family:Family|work:Work";
  await note(["work"]);
  expect(listQueries).toBe(1);
  groups = groups.map((group) => (group.id === "family" ? { ...group, name: "Home" } : group));
  checkedNames = "family:Home|work:Work";
  await note(["work"]);
  expect(listQueries).toBe(2);
  expect(nativeNotices.at(-1)).toEqual({ names: { family: "Home", work: "Work" }, held: ["work"] });
});

test("joining or creating a group refreshes the notice on the next sync", async () => {
  await note(["work"]);
  groups = [...groups, { id: "club", name: "Club", members: [{ id: "m3" }] }];
  forgetSeatHoldGroupNames();
  await note(["work"]);
  expect(listQueries).toBe(2);
  expect(nativeNotices.at(-1)).toEqual({
    names: { ...familyAndWork, club: "Club" },
    held: ["work"],
  });
  await note(["work"]);
  expect(listQueries).toBe(2);
});

test("a hold the phone lost behind the app's back is put back", async () => {
  await note(["work"]);
  nativeHeld = [];
  await note(["work"]);
  expect(listQueries).toBe(2);
  expect(nativeHeld).toEqual(["work"]);
});

test("a hold the phone kept after the app forgot it is lifted", async () => {
  nativeHeld = ["work"];
  await note([]);
  expect(listQueries).toBe(1);
  expect(nativeHeld).toEqual([]);
});

test("nothing changes while the phone belongs to another account", async () => {
  nativeOwnerMatches = false;
  await note(["work"]);
  expect(listQueries).toBe(0);
  expect(nativeNotices).toEqual([]);
});

test("a notice the phone couldn't apply is tried again and says nothing yet", async () => {
  await note(["family"]);
  noticeApplied = false;
  await note([]);
  expect(shown).toEqual([]);
  noticeApplied = true;
  await note([]);
  expect(shown.map((notice) => notice.title)).toEqual(["Family is active again"]);
});

test("leaving a held group doesn't say it's active again", async () => {
  await note(["work"]);
  groups = groups.filter((group) => group.id !== "work");
  await note([]);
  expect(shown).toEqual([]);
  expect(nativeNotices.at(-1)).toEqual({ names: { family: "Family" }, held: [] });
});

test("signing out forgets the holds so the next account starts fresh", async () => {
  await note(["work"]);
  await clearSeatHolds();
  expect(storageValues.size).toBe(0);
  expect(nativeHeld).toEqual([]);
  await note(["work"]);
  expect(listQueries).toBe(2);
});
