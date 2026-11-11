import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const events: string[] = [];
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
    isError: false,
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
  deviceIconFor: () => ({ icon: () => null, label: "Icon" }),
}));
mock.module("../lib/trackingEvents.ts", () => ({
  requestTrackingSync: () => events.push("sync"),
}));
mock.module("../lib/thisDeviceNoun.ts", () => ({ thisDeviceNoun: () => "tablet" }));
mock.module("../lib/pendingJoinCode.ts", () => ({
  openAppAfterSetup: (home: string) => events.push(`open:${home}`),
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
  updateDevice.mockClear();
  root = createRoot();
  await act(async () => root.render(<NameThisPhoneScreen />));
});

test("names a tablet as a tablet", () => {
  expect(JSON.stringify(root.container.toJSON())).toContain('"Name this ","tablet"');
});

test("continuing saves the name, then hands over to the app, opening any saved invite", async () => {
  await press("Continue");

  expect(updateDevice.mock.calls[0]?.[0]).toEqual({
    deviceId: "device-1",
    icon: "phone",
    name: "Pixel 9",
  });
  expect(events).toEqual(["save", "sync", "open:/"]);
});

test("skipping hands over to the app the same way", async () => {
  await press("Skip");

  expect(updateDevice).not.toHaveBeenCalled();
  expect(events).toEqual(["sync", "open:/"]);
});
