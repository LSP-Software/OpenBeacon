import { beforeEach, expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let groupList: {
  data: { id: string; members: { userId: string }[] }[] | undefined;
  isError: boolean;
} = {
  data: [],
  isError: false,
};
const passthrough = ({ children }: { children?: ReactNode }) =>
  React.createElement(React.Fragment, null, children);

mock.module("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[]; select?: (groups: unknown[]) => unknown }) => {
    if (options.queryKey?.[0] === "groupPlaces") {
      return { data: [], isError: false, isPending: false, refetch: async () => {} };
    }
    return {
      data: groupList.data && options.select?.(groupList.data),
      isError: groupList.isError,
      isPending: false,
      refetch: async () => {},
    };
  },
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("expo-router", () => ({ useLocalSearchParams: () => ({ groupId: "family" }) }));
mock.module("react-native", () => ({ ...createReactNativeTestModule(), ScrollView: passthrough }));
mock.module("../components/headers/ScreenHeader.tsx", () => ({ ScreenHeader: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({
  LoadingIndicator: () => "loading",
}));
mock.module("../components/ui/Accordion.tsx", () => ({
  Accordion: passthrough,
  AccordionContent: passthrough,
  AccordionItem: passthrough,
  AccordionTrigger: passthrough,
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: passthrough }));
mock.module("../components/ui/Switch.tsx", () => ({ Switch: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: passthrough }));
mock.module("../hooks/useMemberNames.ts", () => ({
  useMemberNameList: () => () => [],
  useMemberNames: () => () => null,
}));
mock.module("../hooks/usePlaceAlertMutes.ts", () => ({
  usePlaceAlertMutes: () => ({
    mutes: { data: { mutes: [] }, isError: false, isPending: false, refetch: async () => {} },
    setMute: () => {},
  }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: { groupMembership: { list: { queryOptions: () => ({}) } } },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "self" } } }) },
}));
mock.module("../lib/placeSync.ts", () => ({
  groupPlacesQueryOptions: () => ({ queryKey: ["groupPlaces"] }),
}));

let deviceNoun = "phone";
mock.module("../lib/thisDeviceNoun.ts", () => ({ thisDeviceNoun: () => deviceNoun }));

const { default: PlaceAlertsScreen } = await import("../app/place-alerts.tsx");

const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<PlaceAlertsScreen />));
  const text = JSON.stringify(root.container.children);
  await act(async () => root.unmount());
  return text;
};

beforeEach(() => {
  groupList = { data: [], isError: false };
});

test("a group that isn't on this phone says so instead of loading for ever", async () => {
  const text = await render();
  expect(text).toContain("This group isn’t available on this phone.");
  expect(text).not.toContain("loading");
});

test("a failed group list offers to try again", async () => {
  groupList = { data: undefined, isError: true };
  const text = await render();
  expect(text).toContain("Couldn’t load your groups.");
  expect(text).toContain("Try again");
  expect(text).not.toContain("loading");
});

test("says mutes apply on all your devices, using this device's noun", async () => {
  expect(await render()).toContain("This changes your alerts on all your phones.");
  deviceNoun = "tablet";
  expect(await render()).toContain("This changes your alerts on all your tablets.");
  deviceNoun = "phone";
});
