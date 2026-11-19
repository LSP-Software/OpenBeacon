import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "test-renderer";
import type { TimelineDay } from "../lib/timelineTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let downloads = 0;
let sharingReads = 0;
let builtWithPaused: string[][] = [];
let daysSenders = [{ firstHour: null, historyShare: "DAY_1", userId: "user-2" }];

mock.module("../lib/api.ts", () => ({
  trpc: {
    groupTracking: {
      historyDays: {
        queryOptions: ({ groupId }: { groupId: string }) => ({
          queryKey: ["groupTracking.historyDays", groupId],
          queryFn: async () => ({ devices: [], senders: daysSenders, windowStart: new Date() }),
        }),
      },
      getLatest: {
        queryOptions: ({ groupId }: { groupId: string }) => ({
          queryKey: ["groupTracking.getLatest", groupId],
          queryFn: async () => {
            sharingReads += 1;
            return {
              points: [],
              sharing: [
                { deviceId: "paused-phone", paused: true, revisionPrefix: "a", userId: "user-2" },
                { deviceId: "live-phone", paused: false, revisionPrefix: "b", userId: "user-2" },
              ],
            };
          },
        }),
      },
    },
  },
  trpcClient: {},
}));
mock.module("../lib/deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({
    deviceId: "device-1",
    userId: "user-1",
  }),
}));
mock.module("../lib/epochKeys.ts", () => ({
  createHistoryKeyReader: () => async () => null,
  unwrapEpochKeyFromWraps: async () => null,
}));
mock.module("../lib/timelineLoad.ts", () => ({
  loadTimelineDay: async () => {
    downloads += 1;
    return { devices: [], joinStart: null };
  },
}));
mock.module("../lib/timeline.ts", () => ({
  buildTimeline: ({ pausedDeviceIds }: { pausedDeviceIds: ReadonlySet<string> }) => {
    builtWithPaused.push([...pausedDeviceIds]);
    return {};
  },
}));

const { useTimelineDay, useTimelineDays } = await import("./useTimeline.ts");

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

const downloadsAfterReturningToTheApp = async (day: TimelineDay) => {
  downloads = 0;
  sharingReads = 0;
  builtWithPaused = [];
  const Probe = () => {
    useTimelineDay({
      day,
      groupId: "group-1",
      senders: [],
      userIds: ["user-2"],
      windowStart: new Date(day.start - 86_400_000),
    });
    return null;
  };
  const root = createRoot();
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await settle();
  act(() => focusManager.setFocused(false));
  setSystemTime(new Date(Date.now() + 5 * 60_000));
  act(() => focusManager.setFocused(true));
  await settle();
  await act(async () => root.unmount());
  setSystemTime();
  return downloads;
};

afterEach(() => {
  setSystemTime();
  focusManager.setFocused(undefined);
});

test("a finished day is not downloaded and decrypted again on returning to the app", async () => {
  const now = Date.now();
  const day = {
    key: "past",
    start: now - 2 * 86_400_000,
    end: now - 86_400_000,
  };
  expect(await downloadsAfterReturningToTheApp(day)).toBe(1);
});

test("today is refreshed on returning to the app", async () => {
  const now = Date.now();
  const day = { key: "today", start: now - 3_600_000, end: now + 3_600_000 };
  expect(await downloadsAfterReturningToTheApp(day)).toBe(2);
});

test("today's timeline is built knowing which phones are paused now", async () => {
  const now = Date.now();
  await downloadsAfterReturningToTheApp({
    key: "today",
    start: now - 3_600_000,
    end: now + 3_600_000,
  });
  expect(sharingReads).toBeGreaterThan(0);
  expect(builtWithPaused.at(-1)).toEqual(["paused-phone"]);
});

test("a past day doesn't ask who is paused now", async () => {
  const now = Date.now();
  await downloadsAfterReturningToTheApp({
    key: "past",
    start: now - 2 * 86_400_000,
    end: now - 86_400_000,
  });
  expect(sharingReads).toBe(0);
  expect(builtWithPaused.at(-1)).toEqual([]);
});

const cachedDaysAfterRefresh = async (nextShare: string) => {
  daysSenders = [{ firstHour: null, historyShare: "DAY_1", userId: "user-2" }];
  const client = new QueryClient();
  const loaded = { devices: [], joinStart: null };
  client.setQueryData(["timelineDay", "group-1", "past", ["user-2"]], loaded);
  client.setQueryData(["timelineDay", "group-2", "past", ["user-2"]], loaded);
  const Probe = () => {
    useTimelineDays("group-1");
    return null;
  };
  const root = createRoot();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await settle();
  daysSenders = [{ firstHour: null, historyShare: nextShare, userId: "user-2" }];
  await act(() => client.refetchQueries({ queryKey: ["groupTracking.historyDays"] }));
  await settle();
  await act(async () => root.unmount());
  return {
    thisGroup: client.getQueryData(["timelineDay", "group-1", "past", ["user-2"]]),
    otherGroup: client.getQueryData(["timelineDay", "group-2", "past", ["user-2"]]),
  };
};

test("a member's new history-sharing choice drops this group's downloaded days", async () => {
  const cached = await cachedDaysAfterRefresh("LAST_LOCATION");
  expect(cached.thisGroup).toBeUndefined();
  expect(cached.otherGroup).toBeDefined();
});

test("refreshing with the same history-sharing choices keeps the downloaded days", async () => {
  expect((await cachedDaysAfterRefresh("DAY_1")).thisGroup).toBeDefined();
});
