import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const events: string[] = [];
let devicesFailedToRefresh = false;
const updateDevice = mock(async (_input: { deviceId: string; name: string; icon: string }) => {
  events.push("save");
});

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Stack: { Screen: () => null },
  useFocusEffect: () => {},
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: updateDevice }),
  useQuery: () => ({
    data: [{ icon: "phone", id: "device-1", isCurrent: true, name: "Pixel 9" }],
    isError: devicesFailedToRefresh,
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-native", () => ({
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: "android" },
  Pressable: View,
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Input.tsx", () => ({ Input: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => events.push("alert") } }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    account: {
      listDevices: { queryKey: () => ["devices"], queryOptions: () => ({}) },
      updateDevice: { mutationOptions: () => ({}) },
    },
  },
}));
mock.module("../lib/deviceIcons.ts", () => ({
  selectableDeviceIcons: ["phone", "tablet"],
  deviceIconFor: () => ({ icon: () => null, label: "Icon" }),
}));
mock.module("../lib/trackingEvents.ts", () => ({
  requestTrackingSync: () => events.push("sync"),
}));
mock.module("../lib/thisDeviceNoun.ts", () => ({ thisDeviceNoun: () => "tablet" }));
mock.module("../lib/onboarding.ts", () => ({
  advanceOnboarding: (step: string) => events.push(`advance:${step}`),
}));
mock.module("../components/onboarding/OnboardingScreen.tsx", () => ({
  useAdvanceOnboardingOnce: () => (step: string) => events.push(`advance:${step}`),
  OnboardingScreen: ({
    title,
    children,
    primary,
    secondary,
  }: {
    title: string;
    children?: React.ReactNode;
    primary: { label: string; onPress: () => void };
    secondary?: { label: string; onPress: () => void };
  }) => (
    <>
      <View>{title}</View>
      {children}
      {React.createElement("mock-button", { onPress: primary.onPress }, primary.label)}
      {secondary &&
        React.createElement("mock-button", { onPress: secondary.onPress }, secondary.label)}
    </>
  ),
}));

const { default: NameThisPhoneScreen } = await import("../app/setup/name.tsx");

let root: Root;

const press = async (label: string) => {
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes(label));
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => (button.props as { onPress: () => void }).onPress());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

beforeEach(async () => {
  events.length = 0;
  devicesFailedToRefresh = false;
  updateDevice.mockClear();
  root = createRoot();
  await act(async () => root.render(<NameThisPhoneScreen />));
});

test("names a tablet as a tablet", () => {
  expect(JSON.stringify(root.container.toJSON())).toContain("Name this tablet");
});

test("continuing saves the name, then moves on to the next onboarding step", async () => {
  await press("Continue");

  expect(updateDevice.mock.calls[0]?.[0]).toEqual({
    deviceId: "device-1",
    icon: "phone",
    name: "Pixel 9",
  });
  expect(events).toEqual(["save", "sync", "advance:name"]);
});

test("skipping moves on the same way without saving", async () => {
  await press("Skip");

  expect(updateDevice).not.toHaveBeenCalled();
  expect(events).toEqual(["sync", "advance:name"]);
});

test("a failed background refresh keeps the loaded device and the Continue button", async () => {
  devicesFailedToRefresh = true;
  await act(async () => root.render(<NameThisPhoneScreen />));

  expect(JSON.stringify(root.container.toJSON())).not.toContain("couldn’t load");
  await press("Continue");
  expect(updateDevice.mock.calls[0]?.[0]?.deviceId).toBe("device-1");
});
