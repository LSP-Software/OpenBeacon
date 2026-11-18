import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "test-renderer";
import type { TimelineDay } from "../lib/timelineTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let downloads = 0;

mock.module("../lib/api.ts", () => ({ trpc: {}, trpcClient: {} }));
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
mock.module("../lib/timeline.ts", () => ({ buildTimeline: () => ({}) }));

const { useTimelineDay } = await import("./useTimeline.ts");

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

const downloadsAfterReturningToTheApp = async (day: TimelineDay) => {
  downloads = 0;
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
