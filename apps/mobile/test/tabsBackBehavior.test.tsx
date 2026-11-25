import { expect, mock, test } from "bun:test";
import { CommonActions, StackRouter, TabRouter } from "@react-navigation/routers";
import type React from "react";
import { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let tabsProps: { backBehavior?: "history" | "none" | "initialRoute" } | null = null;
const triggers: string[] = [];
const passthrough = ({ children }: { children?: React.ReactNode }) => children ?? null;
const NativeTabs = Object.assign(
  (props: { backBehavior?: "history"; children?: React.ReactNode }) => {
    tabsProps = props;
    return props.children;
  },
  {
    Trigger: Object.assign(
      ({ name }: { name: string }) => {
        triggers.push(name);
        return null;
      },
      { Icon: passthrough, Label: passthrough, Badge: passthrough },
    ),
  },
);
mock.module("expo-router", () => ({ Redirect: () => null, Stack: () => null }));
mock.module("expo-router/unstable-native-tabs", () => ({ NativeTabs }));
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("../lib/theme.ts", () => ({
  useColors: () => ({ palette: new Proxy({}, { get: () => "#000000" }) }),
}));
mock.module("../components/headers/useHeaderOptions.ts", () => ({ useHeaderOptions: () => ({}) }));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: () => {} }),
  useQuery: () => ({ data: undefined }),
}));
mock.module("../components/HistoryShareNotice.tsx", () => ({ HistoryShareNotice: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../hooks/useAppForeground.ts", () => ({ useAppForeground: () => {} }));
mock.module("../hooks/useRefetchWhileFocused.ts", () => ({ useRefetchWhileFocused: () => {} }));
mock.module("../hooks/useUnits.ts", () => ({ useUnits: () => ({ speed: "mph" }) }));
mock.module("../lib/crashAlerts.ts", () => ({ syncCrashAlertContext: () => {} }));
mock.module("../lib/driveSettings.ts", () => ({ syncDriveDistanceUnit: () => {} }));
mock.module("../hooks/useUnseenGroupHistory.ts", () => ({
  useUnseenGroupHistory: () => ({ unseenGroupIds: new Set() }),
}));
mock.module("../lib/api.ts", () => ({
  queryClient: {},
  trpc: {
    auth: { providers: { queryOptions: () => ({}) } },
    emailAlerts: { setTimezone: { mutationOptions: () => ({}) } },
    groupHistory: { latest: { queryKey: () => [] } },
    groupMembership: { list: { queryOptions: () => ({}) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false }) },
}));
mock.module("../lib/groupColorSync.ts", () => ({ groupColorSyncQueryOptions: () => ({}) }));
mock.module("../lib/imageKeySelfCheck.ts", () => ({ checkImageKeys: async () => false }));

const { default: TabsLayout } = await import("../app/(tabs)/_layout.tsx");
const { unstable_settings: groupsSettings } = await import("../app/(tabs)/groups/_layout.tsx");

test("Back from a group opened from the map returns to the groups list, then the map", async () => {
  const root = createRoot();
  await act(async () => root.render(<TabsLayout />));
  await act(async () => root.unmount());
  if (!tabsProps) throw new Error("Tabs not rendered");

  const tabs = TabRouter({
    initialRouteName: triggers[0] ?? "",
    backBehavior: tabsProps.backBehavior ?? "firstRoute",
  });
  const tabOptions = { routeNames: triggers, routeParamList: {}, routeGetIdList: {} };
  const groupRouteNames = ["list", "[groupId]/index"];
  const groups = StackRouter({ initialRouteName: groupsSettings.initialRouteName });
  const groupOptions = { routeNames: groupRouteNames, routeParamList: {}, routeGetIdList: {} };
  const jumpTo = (name: string) => ({ type: "JUMP_TO" as const, payload: { name } });
  const tabStep = (
    state: ReturnType<typeof tabs.getInitialState>,
    action: Parameters<typeof tabs.getStateForAction>[1],
  ) => {
    const next = tabs.getStateForAction(state, action, tabOptions);
    if (next?.stale !== false) throw new Error("Navigation didn't settle");
    return next;
  };

  const onGroupStack = groups.getStateForAction(
    groups.getInitialState(groupOptions),
    { type: "PUSH" as const, payload: { name: "[groupId]/index" } },
    groupOptions,
  );
  if (onGroupStack?.stale !== false) throw new Error("Group didn't open");
  const groupBack = groups.getStateForAction(onGroupStack, CommonActions.goBack(), groupOptions);
  if (groupBack?.stale !== false) throw new Error("Group didn't close");
  expect(groupBack.routes[groupBack.index]?.name).toBe("list");
  expect(groups.getStateForAction(groupBack, CommonActions.goBack(), groupOptions)).toBeNull();

  const onMap = tabStep(tabs.getInitialState(tabOptions), jumpTo("map"));
  const onGroups = tabStep(onMap, jumpTo("groups"));
  const back = tabStep(onGroups, CommonActions.goBack());
  expect(back.routes[back.index]?.name).toBe("map");
});
