import { beforeEach, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const storageValues = new Map<string, string>();
const shown: Array<{ title: string; body: string | null; kind: string }> = [];
const nativeNotices: Array<{ sharing: string[]; held: string[] }> = [];
let paused = false;

mock.module("react-native", () => createReactNativeTestModule({ platformOS: "android" }));
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
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
        query: async () => [
          { id: "family", name: "Family" },
          { id: "work", name: "Work" },
        ],
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
      return true;
    },
  }),
}));

const { noteHeldGroups } = await import("./seatHolds.ts");

const note = (heldGroupIds: string[]) =>
  noteHeldGroups({ deviceId: "phone", heldGroupIds, userId: "sam" });

beforeEach(() => {
  storageValues.clear();
  shown.length = 0;
  nativeNotices.length = 0;
  paused = false;
});

test("the sharing notice lists only the groups this phone shares with", async () => {
  await note(["work"]);
  expect(nativeNotices).toEqual([{ sharing: ["Family"], held: ["Work"] }]);
  expect(shown).toEqual([]);

  await note(["work"]);
  expect(nativeNotices).toHaveLength(2);
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
