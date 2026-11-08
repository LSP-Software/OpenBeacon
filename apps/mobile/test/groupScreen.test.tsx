import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let queryResult: { data: unknown; isPending: boolean; error: { data: { code: string } } | null };
let isFocused = true;
let sessionUserId = "user-1";
const storedFlags = new Map<string, boolean>();
let groups: { id: string }[] = [];
let keyAccess: {
  data: {
    current: "available" | "missing" | "unavailable";
    history: "complete" | { partialFrom: Date };
  };
  isError: boolean;
}[] = [];
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
    groupMembership: {
      get: { queryOptions: () => ({}) },
      list: { queryOptions: () => ({}) },
    },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: sessionUserId } } }) },
}));
mock.module("../hooks/useGroupKeyAccess.ts", () => ({ useGroupKeyAccess: () => keyAccess }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/image/GroupImage.tsx", () => ({ GroupImage: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({
  LoadingIndicator: () => null,
}));
mock.module("../components/RefreshablePage.tsx", () => ({
  RefreshablePage: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => storedFlags.get(key),
    set: (key: string, value: boolean) => storedFlags.set(key, value),
  },
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
    React.createElement("pressable", { onPress }, children),
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
  sessionUserId = "user-1";
  storedFlags.clear();
  groups = [];
  keyAccess = [];
  replace.mockClear();
  fetchQuery.mockClear();
  queryResult = {
    data: { id: "group-1", name: "Family", groupMembers: [] },
    isPending: false,
    error: null,
  };
});

test("shows key access problems without offering recovery", async () => {
  keyAccess = [{ data: { current: "missing", history: "complete" }, isError: true }];
  queryResult = {
    ...queryResult,
    data: { id: "group-1", name: "Family", groupMembers: [{ role: "OWNER" }] },
  };
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  expect(JSON.stringify(root.container.toJSON())).toContain(
    "Current group locations may be unavailable on this device.",
  );
  expect(JSON.stringify(root.container.toJSON())).not.toContain("location history");

  queryResult = {
    ...queryResult,
    data: { id: "group-1", name: "Family", groupMembers: [{ role: "MEMBER" }] },
  };
  await act(async () => root.render(<GroupScreen />));
  expect(JSON.stringify(root.container.toJSON())).not.toContain("Restore group key");
  await act(async () => root.unmount());
});

test("reports partial history separately from current access", async () => {
  keyAccess = [
    {
      data: { current: "available", history: { partialFrom: new Date("2026-10-03T12:00:00Z") } },
      isError: false,
    },
  ];
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  const rendered = JSON.stringify(root.container.toJSON());
  expect(rendered).toContain("Some location history isn’t available on this device");
  expect(rendered).toContain("2026");
  expect(rendered).not.toContain("current encryption key");
  await act(async () => root.unmount());
});

test("dismissing the partial history warning hides it for that user and group only", async () => {
  keyAccess = [
    {
      data: { current: "available", history: { partialFrom: new Date("2026-10-03T12:00:00Z") } },
      isError: false,
    },
  ];
  const warning = "Some location history isn’t available on this device";
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  const [dismiss] = root.container.queryAll((item) => item.type === "pressable");
  if (!dismiss) throw new Error("Dismiss button not found");
  await act(async () => (dismiss.props as { onPress: () => void }).onPress());
  expect(JSON.stringify(root.container.toJSON())).not.toContain(warning);
  expect(storedFlags.get("recovery.historyWarningDismissed.user-1.group-1")).toBe(true);
  await act(async () => root.unmount());

  const remounted = createRoot();
  await act(async () => remounted.render(<GroupScreen />));
  expect(JSON.stringify(remounted.container.toJSON())).not.toContain(warning);
  await act(async () => remounted.unmount());

  sessionUserId = "user-2";
  const otherUser = createRoot();
  await act(async () => otherUser.render(<GroupScreen />));
  expect(JSON.stringify(otherUser.container.toJSON())).toContain(warning);
  await act(async () => otherUser.unmount());
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
