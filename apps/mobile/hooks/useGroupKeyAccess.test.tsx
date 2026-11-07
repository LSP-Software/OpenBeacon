import { expect, mock, test } from "bun:test";
import { createDeviceKeyPair, createInitialGroupEpoch } from "@openbeacon/encryption";
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
let registered = false;
let rotated = false;
let offline = false;
const register = mock(async () => {
  registered = true;
  return { deviceId: "device", privateKey: keyPair.privateKey };
});

mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("../lib/deviceKeys.ts", () => ({ ensureDeviceKeyRegistration: register }));
mock.module("../lib/api.ts", () => ({
  trpcClient: {
    groupEpoch: {
      getLatest: { query: async () => ({ epochId: epoch.epoch.epochId }) },
      getWrappedKey: {
        query: async () => {
          if (offline) throw new Error("offline");
          return registered && rotated ? epoch.wrappedKeys[0] : null;
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
  expect(queryClient.getQueryData<string>(queryKey)).toBe("missing");

  offline = true;
  await act(async () => {
    await queryClient.refetchQueries({ queryKey });
  });
  expect(queryClient.getQueryData<string>(queryKey)).toBe("missing");
  expect(queryClient.getQueryState(queryKey)?.status).toBe("error");

  offline = false;
  rotated = true;
  await act(async () => {
    notifyGroupEpochChange("group");
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(queryClient.getQueryData<string>(queryKey)).toBe("available");
  await act(async () => root.unmount());
  queryClient.clear();
});
