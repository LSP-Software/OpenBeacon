import { beforeEach, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const storageValues = new Map<string, string>();
const shown: Array<{ title: string; body: string | null; kind: string }> = [];
const nativeNotices: Array<{ sharing: string[]; held: string[] }> = [];
let paused = false;
let listQueries = 0;
let groups = [
  { id: "family", name: "Family", members: [{ id: "m1" }] },
  { id: "work", name: "Work", members: [{ id: "m2" }] },
];
let noticeApplied = true;
let checkedMembership: string | null = null;

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
  queryClient: { invalidateQueries: async () => {} },
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
    setSeatHoldNotice: (_owner: string, _deviceId: string, sharing: string[], held: string[]) => {
      nativeNotices.push({ sharing, held });
      return noticeApplied;
    },
    clearSeatHoldNotices: () => {
      nativeNotices.push({ sharing: [], held: [] });
    },
  }),
}));
mock.module("./trackingKeyCheck.ts", () => ({
  getCheckedMembership: () => checkedMembership,
  getMembershipSignature: (list: { id: string; members: { id: string }[] }[]) =>
    list
      .map((group) => `${group.id}:${group.members.map((member) => member.id).join(",")}`)
      .join("|"),
}));

const { clearSeatHolds, noteHeldGroups } = await import("./seatHolds.ts");

const note = (heldGroupIds: string[]) =>
  noteHeldGroups({ deviceId: "phone", heldGroupIds, userId: "sam" });

beforeEach(() => {
  storageValues.clear();
  shown.length = 0;
  nativeNotices.length = 0;
  paused = false;
  listQueries = 0;
  groups = [
    { id: "family", name: "Family", members: [{ id: "m1" }] },
    { id: "work", name: "Work", members: [{ id: "m2" }] },
  ];
  noticeApplied = true;
  checkedMembership = null;
});

test("the sharing notice lists only the groups this phone shares with", async () => {
  await note(["work"]);
  expect(nativeNotices).toEqual([{ sharing: ["Family"], held: ["Work"] }]);
  expect(shown).toEqual([]);

  await note(["work"]);
  expect(nativeNotices).toHaveLength(1);
  expect(shown).toEqual([]);

  await note(["family", "work"]);
  expect(nativeNotices.at(-1)).toEqual({ sharing: [], held: ["Family", "Work"] });
});

test("a phone that has never been on hold doesn't touch the notice", async () => {
  await note([]);
  await note([]);
  expect(nativeNotices).toEqual([]);
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
  expect(nativeNotices.at(-1)).toEqual({ sharing: ["Family"], held: ["Work"] });
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

test("a membership change refreshes the notice for an unchanged hold", async () => {
  await note(["work"]);
  checkedMembership = "family:m1|work:m2";
  await note(["work"]);
  expect(listQueries).toBe(1);
  groups = [...groups, { id: "club", name: "Club", members: [{ id: "m3" }] }];
  checkedMembership = "club:m3|family:m1|work:m2";
  await note(["work"]);
  expect(listQueries).toBe(2);
  expect(nativeNotices.at(-1)).toEqual({ sharing: ["Family", "Club"], held: ["Work"] });
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
  expect(nativeNotices.at(-1)).toEqual({ sharing: ["Family"], held: [] });
});

test("signing out forgets the holds so the next account starts fresh", async () => {
  await note(["work"]);
  await clearSeatHolds();
  expect(storageValues.size).toBe(0);
  await note(["work"]);
  expect(listQueries).toBe(2);
});
