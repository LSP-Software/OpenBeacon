import { expect, mock, test } from "bun:test";
import { CommonActions, TabRouter } from "@react-navigation/routers";
import type React from "react";
import { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let tabsProps: { initialRouteName: string; backBehavior?: "history" } | null = null;
const Tabs = Object.assign(
  (props: { initialRouteName: string; backBehavior?: "history"; children?: React.ReactNode }) => {
    tabsProps = props;
    return null;
  },
  { Screen: () => null },
);
mock.module("expo-router", () => ({ Redirect: () => null, Tabs }));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: () => {} }),
  useQuery: () => ({ data: undefined }),
}));
mock.module("../components/HistoryShareNotice.tsx", () => ({ HistoryShareNotice: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/TabBar.tsx", () => ({ TabBar: () => null }));
mock.module("../hooks/useAppForeground.ts", () => ({ useAppForeground: () => {} }));
mock.module("../hooks/useRefetchWhileFocused.ts", () => ({ useRefetchWhileFocused: () => {} }));
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

test("Back from a group opened from the map returns to the map", async () => {
  const root = createRoot();
  await act(async () => root.render(<TabsLayout />));
  await act(async () => root.unmount());
  if (!tabsProps) throw new Error("Tabs not rendered");

  const routeNames = ["groups/list", "map/index", "account/overview", "groups/[groupId]/index"];
  const router = TabRouter({
    initialRouteName: tabsProps.initialRouteName,
    backBehavior: tabsProps.backBehavior ?? "firstRoute",
  });
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  const step = (
    state: ReturnType<typeof router.getInitialState>,
    action: Parameters<typeof router.getStateForAction>[1],
  ) => {
    const next = router.getStateForAction(state, action, options);
    if (next?.stale !== false) throw new Error("Navigation didn't settle");
    return next;
  };
  const jumpTo = (name: string) => ({ type: "JUMP_TO" as const, payload: { name } });
  const onMap = step(router.getInitialState(options), jumpTo("map/index"));
  const onGroup = step(onMap, jumpTo("groups/[groupId]/index"));
  const back = step(onGroup, CommonActions.goBack());

  expect(back.routes[back.index]?.name).toBe("map/index");
});
