import { expect, mock, spyOn, test } from "bun:test";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

const tasks = new Map<string, () => (data: { reason?: string } | undefined) => Promise<void>>();
const reasons: string[] = [];
let syncError: Error | null = null;

mock.module("react-native", () => ({
  ...createReactNativeTestModule({ platformOS: "android" }),
  AppRegistry: {
    registerHeadlessTask: (
      key: string,
      provider: () => (data: { reason?: string } | undefined) => Promise<void>,
    ) => {
      tasks.set(key, provider);
    },
  },
}));
mock.module("../lib/installCrypto.ts", () => ({}));
mock.module("expo-router/entry", () => ({}));
mock.module("../lib/tracking.ts", () => ({
  syncBackgroundTracking: async (reason: string) => {
    reasons.push(reason);
    if (syncError) throw syncError;
  },
}));

await import("../index.ts");

const runTask = (data: { reason?: string } | undefined) => {
  const provider = tasks.get("OpenBeaconTrackingUpload");
  if (!provider) throw new Error("The upload task isn't registered");
  return provider()(data);
};

test("a failed background sync still finishes the task so Android can run the next one", async () => {
  syncError = new Error("Tracking upload failed");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  await expect(runTask({ reason: "push" })).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
  syncError = null;
});

test("unknown reasons run a normal upload", async () => {
  reasons.length = 0;
  await runTask({ reason: "parked" });
  await runTask({ reason: "something" });
  await runTask(undefined);
  expect(reasons).toEqual(["parked", "upload", "upload"]);
});
