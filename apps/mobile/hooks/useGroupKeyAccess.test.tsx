import { expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "test-renderer";
import { notifyGroupEpochChange } from "../lib/trackingEvents.ts";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const keyPair = createDeviceKeyPair();
const epoch = createInitialGroupEpoch({
  creator: { deviceId: "device", privateKey: keyPair.privateKey },
  groupId: "group",
  recipients: [
    {
      algorithm: keyPair.algorithm,
      createdAt: new Date(),
      deviceId: "device",
      publicKey: keyPair.publicKey,
      revokedAt: null,
      userId: "user",
    },
  ],
});
const historyKey = createHistoryKeyPair();
const historyWrap = {
  ...wrapEpochKeyForHistoryKey({
    epochId: epoch.epoch.epochId,
    epochKey: epoch.epochKey,
    historyKey: { publicKey: historyKey.publicKey, userId: "user", version: 1 },
    senderPrivateKey: keyPair.privateKey,
  }),
  createdAt: new Date(0),
};
let historyWrapOnly = false;
let historyWrapDeleted = false;
let registered = false;
let rotated = false;
let offline = false;
const register = mock(async () => {
  registered = true;
  return { deviceId: "device", privateKey: keyPair.privateKey, userId: "user" };
});

mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("../lib/deviceKeys.ts", () => ({ ensureDeviceKeyRegistration: register }));
mock.module("../lib/historyKeys.ts", () => ({
  getStoredHistoryKey: async ({ version }: { version: number }) =>
    historyWrapOnly && version === 1 ? historyKey.privateKey : null,
  storeHistoryKey: async () => {},
}));
mock.module("../lib/api.ts", () => ({
  trpcClient: {
    groupEpoch: {
      listEpochKeyWraps: {
        query: async () => {
          if (offline) throw new Error("offline");
          return {
            epochs: [
              {
                createdAt: new Date(0),
                deviceWrap: registered && rotated && !historyWrapOnly ? epoch.wrappedKeys[0] : null,
                epochId: epoch.epoch.epochId,
                epochNumber: 1,
                historyWraps: historyWrapOnly && !historyWrapDeleted ? [historyWrap] : [],
              },
            ],
            nextCursor: null,
          };
        },
      },
    },
  },
}));

const { useGroupKeyAccess }: typeof import("./useGroupKeyAccess.ts") =
  await import("./useGroupKeyAccess.ts");

test("registers the device and refreshes missing access after rotation", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Harness = () => {
    useGroupKeyAccess(["group"], "user");
    return null;
  };
  const root = createRoot();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  const queryKey = ["groupKeyAccess", "user", "group"];
  await act(async () => {
    await queryClient.refetchQueries({ queryKey });
  });
  expect(register).toHaveBeenCalled();
  expect(queryClient.getQueryData<unknown>(queryKey)).toEqual({
    current: "missing",
    history: "complete",
  });

  offline = true;
  await act(async () => {
    await queryClient.refetchQueries({ queryKey });
  });
  expect(queryClient.getQueryData<unknown>(queryKey)).toEqual({
    current: "missing",
    history: "complete",
  });
  expect(queryClient.getQueryState(queryKey)?.status).toBe("error");

  offline = false;
  rotated = true;
  await act(async () => {
    notifyGroupEpochChange("group");
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(queryClient.getQueryData<unknown>(queryKey)).toEqual({
    current: "available",
    history: "complete",
  });
  await act(async () => root.unmount());
  queryClient.clear();
});

test("rechecks an epoch once the history wrap that resolved it is deleted by a reset", async () => {
  historyWrapOnly = true;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Harness = () => {
    useGroupKeyAccess(["group"], "user");
    return null;
  };
  const root = createRoot();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  const queryKey = ["groupKeyAccess", "user", "group"];
  await act(async () => {
    await queryClient.refetchQueries({ queryKey });
  });
  expect(queryClient.getQueryData<unknown>(queryKey)).toEqual({
    current: "available",
    history: "complete",
  });

  historyWrapDeleted = true;
  await act(async () => {
    await queryClient.refetchQueries({ queryKey });
  });
  expect(queryClient.getQueryData<unknown>(queryKey)).toEqual({
    current: "missing",
    history: "complete",
  });
  await act(async () => root.unmount());
  queryClient.clear();
});
