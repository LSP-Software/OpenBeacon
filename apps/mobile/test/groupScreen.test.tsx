import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let queryResult: { data: unknown; isPending: boolean; error: { data: { code: string } } | null };
let isFocused = true;
let groups: { id: string }[] = [];
const replace = mock(() => {});
const fetchQuery = mock(async () => groups);
const queryClient = { fetchQuery };
const router = { replace };
mock.module("@tanstack/react-query", () => ({
  useQuery: () => queryResult,
  useQueryClient: () => queryClient,
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => isFocused }));
mock.module("expo-router", () => ({
  useLocalSearchParams: () => ({ groupId: "group-1" }),
  useRouter: () => router,
}));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("lucide-react-native", () => ({
  Clock3Icon: () => null,
  SlidersHorizontalIcon: () => null,
  UsersIcon: () => null,
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    groupMembership: { get: { queryOptions: () => ({}) }, list: { queryOptions: () => ({}) } },
  },
}));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/image/GroupImage.tsx", () => ({ GroupImage: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({
  LoadingIndicator: () => null,
}));
mock.module("../components/RefreshablePage.tsx", () => ({
  RefreshablePage: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../components/ui/SwipeTabs.tsx", () => ({ SwipeTabs: () => null }));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../app/(tabs)/groups/[groupId]/MembersTab.tsx", () => ({ default: () => null }));
mock.module("../app/(tabs)/groups/[groupId]/HistoryTab.tsx", () => ({ default: () => null }));
mock.module("../app/(tabs)/groups/[groupId]/SettingsTab.tsx", () => ({ default: () => null }));

const { default: GroupScreen } = await import("../app/(tabs)/groups/[groupId]/index.tsx");

beforeEach(() => {
  isFocused = true;
  groups = [];
  replace.mockClear();
  fetchQuery.mockClear();
  queryResult = {
    data: { id: "group-1", name: "Family", groupMembers: [] },
    isPending: false,
    error: null,
  };
});

test("does not redirect from an unfocused group screen when its refresh loses access", async () => {
  isFocused = false;
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  queryResult = { ...queryResult, error: { data: { code: "FORBIDDEN" } } };
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(replace).not.toHaveBeenCalled();
  isFocused = true;
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(replace).toHaveBeenCalledWith("/(tabs)/groups/list");
  await act(async () => {
    root.unmount();
  });
});

test("returns to groups when a deleted group becomes inaccessible during a refetch", async () => {
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  queryResult = { ...queryResult, error: { data: { code: "FORBIDDEN" } } };
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(replace).toHaveBeenCalledWith("/(tabs)/groups/list");
  expect(fetchQuery).toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test("does not redirect when a fresh membership list still contains the group", async () => {
  groups = [{ id: "group-1" }];
  queryResult = { ...queryResult, error: { data: { code: "FORBIDDEN" } } };
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(fetchQuery).toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test("does not leave the group on a temporary request failure", async () => {
  queryResult = { ...queryResult, error: { data: { code: "INTERNAL_SERVER_ERROR" } } };
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(replace).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});
