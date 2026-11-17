import { expect, mock, spyOn, test } from "bun:test";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

const tasks = new Map<
  string,
  () => (data: { reason?: string; taskToken?: string } | undefined) => Promise<void>
>();
const reasons: string[] = [];
const finishedTokens: string[] = [];
let finishError: Error | null = null;
let syncError: Error | null = null;

mock.module("react-native", () => ({
  ...createReactNativeTestModule({ platformOS: "android" }),
  AppRegistry: {
    registerHeadlessTask: (
      key: string,
      provider: () => (data: { reason?: string; taskToken?: string } | undefined) => Promise<void>,
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

mock.module("../lib/trackingModule.ts", () => ({
  loadTrackingModule: async () => ({
    finishUploadTask: (token: string) => {
      if (finishError) throw finishError;
      finishedTokens.push(token);
    },
  }),
}));

await import("../index.ts");

const runTask = (data: { reason?: string; taskToken?: string } | undefined) => {
  const provider = tasks.get("OpenBeaconTrackingUpload");
  if (!provider) throw new Error("The upload task isn't registered");
  return provider()(data);
};

test("a failed background sync still finishes the task so Android can run the next one", async () => {
  finishedTokens.length = 0;
  syncError = new Error("Tracking upload failed");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  await expect(runTask({ reason: "push", taskToken: "failed-token" })).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(finishedTokens).toEqual(["failed-token"]);
  warn.mockRestore();
  syncError = null;
});

test("a finished sync tells Android its own task is done", async () => {
  finishedTokens.length = 0;
  await runTask({ reason: "upload", taskToken: "first-token" });
  await runTask({ reason: "push", taskToken: "second-token" });
  await runTask({ reason: "upload" });
  expect(finishedTokens).toEqual(["first-token", "second-token"]);
});

test("a task that can't tell Android it finished still resolves", async () => {
  finishError = new Error("Native module missing");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  await expect(runTask({ reason: "upload", taskToken: "token" })).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
  finishError = null;
});

test("unknown reasons run a normal upload", async () => {
  reasons.length = 0;
  await runTask({ reason: "parked" });
  await runTask({ reason: "something" });
  await runTask(undefined);
  expect(reasons).toEqual(["parked", "upload", "upload"]);
});
