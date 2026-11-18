import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { GroupHistoryItem } from "../lib/groupHistory.ts";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let queryResult: { data: unknown; isPending: boolean };
let isFocused = true;
let sessionUserId = "user-1";
let routeGroupId = "group-1";
let selectedTab: { value: string; onValueChange: (value: string) => void } | null = null;
const storedValues = new Map<string, number>();
let groups: { id: string }[] = [];
let keyAccess: {
  data: {
    current: "available" | "missing" | "unavailable";
    history: "complete" | { partialFrom: Date };
  };
  isError: boolean;
}[] = [];
const replace = mock(() => {});
let fetchGroups: () => Promise<{ id: string }[]> = async () => groups;
const fetchQuery = mock(() => fetchGroups());
const invalidateQueries = mock(async () => {});
const queryClient = { fetchQuery, invalidateQueries };
const latestAt = new Date("2026-11-16T12:00:00Z");
let historyResult: {
  data: { pages: { items: GroupHistoryItem[]; nextBefore: null }[] } | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
};
const router = { replace };
mock.module("@tanstack/react-query", () => ({
  skipToken: Symbol("skipToken"),
  useQuery: ({ select }: { select?: (data: unknown) => unknown }) => ({
    ...queryResult,
    data: select && queryResult.data !== undefined ? select(queryResult.data) : queryResult.data,
  }),
  useQueryClient: () => queryClient,
  useInfiniteQuery: () => historyResult,
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => isFocused }));
mock.module("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({ groupId: routeGroupId }),
  useRouter: () => router,
}));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("lucide-react-native", () => ({
  ImageIcon: () => null,
  LogInIcon: () => null,
  LogOutIcon: () => null,
  MapPinMinusIcon: () => null,
  MapPinPenIcon: () => null,
  MapPinPlusIcon: () => null,
  PencilIcon: () => null,
  ShieldIcon: () => null,
  SparklesIcon: () => null,
  UserMinusIcon: () => null,
  UserPlusIcon: () => null,
  UserXIcon: () => null,

  Clock3Icon: () => null,
  MapPinIcon: () => null,
  SlidersHorizontalIcon: () => null,
  UsersIcon: () => null,
}));
mock.module("../lib/api.ts", () => ({
  trpcClient: {},
  trpc: {
    groupMembership: {
      list: { queryOptions: () => ({}) },
    },
    groupHistory: {
      latest: { queryKey: () => ["groupHistoryLatest"] },
    },
    accountRecovery: {
      status: { queryOptions: () => ({}) },
    },
  },
}));
mock.module("../hooks/useHeldHistoryKeyVersions.ts", () => ({
  useHeldHistoryKeyVersions: () => ({ data: undefined }),
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: sessionUserId } } }) },
}));
mock.module("../hooks/useGroupKeyAccess.ts", () => ({ useGroupKeyHistoryAccess: () => keyAccess }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/image/GroupImage.tsx", () => ({ GroupImage: () => null }));
mock.module("../lib/imageKeyCatchUp.ts", () => ({ catchUpGroupImageKeys: async () => 0 }));
mock.module("../lib/groupEncryption.ts", () => ({ rotateGroupEpochIfRequired: async () => false }));
mock.module("../components/LoadingIndicator.tsx", () => ({
  LoadingIndicator: () => "Loading",
}));
mock.module("../components/RefreshablePage.tsx", () => ({
  RefreshablePage: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getNumber: (key: string) => storedValues.get(key),
    set: (key: string, value: number) => storedValues.set(key, value),
  },
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
    React.createElement("pressable", { onPress }, children),
}));
mock.module("../components/ui/SwipeTabs.tsx", () => ({
  SwipeTabs: (props: {
    value: string;
    onValueChange: (value: string) => void;
    renderScene: (value: string) => React.ReactNode;
  }) => {
    selectedTab = props;
    return props.renderScene(props.value);
  },
}));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../components/groups/MembersTab.tsx", () => ({ default: () => null }));
mock.module("../hooks/useMemberNames.ts", () => ({ useMemberNames: () => () => null }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/groups/PlacesTab.tsx", () => ({ default: () => null }));
mock.module("../hooks/useUnseenGroupHistory.ts", () => ({
  useUnseenGroupHistory: () => ({
    latest: [{ groupId: routeGroupId, latestAt }],
    unseenGroupIds: new Set([routeGroupId]),
    userId: sessionUserId,
  }),
}));
mock.module("../hooks/useLiveTrackingPositions.ts", () => ({
  useLiveTrackingPositions: () => ({ positions: [], status: { undecryptable: [] } }),
}));
mock.module("../components/groups/SettingsTab.tsx", () => ({ default: () => null }));

const { default: GroupScreen } = await import("../app/(tabs)/groups/[groupId]/index.tsx");
const { default: HistoryTab } = await import("../components/groups/HistoryTab.tsx");

const family = (members: { role: string; userId: string }[], id = "group-1") => ({
  id,
  image: null,
  members,
  name: "Family",
});

beforeEach(() => {
  isFocused = true;
  sessionUserId = "user-1";
  routeGroupId = "group-1";
  selectedTab = null;
  historyResult = {
    data: undefined,
    isPending: false,
    isError: true,
    isSuccess: false,
    isFetching: false,
  };
  storedValues.clear();
  groups = [];
  fetchGroups = async () => groups;
  keyAccess = [];
  replace.mockClear();
  fetchQuery.mockClear();
  queryResult = { data: [family([])], isPending: false };
});

test("shows key access problems without offering recovery", async () => {
  keyAccess = [{ data: { current: "missing", history: "complete" }, isError: true }];
  queryResult = {
    ...queryResult,
    data: [family([{ role: "OWNER", userId: "user-1" }])],
  };
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  expect(JSON.stringify(root.container.toJSON())).toContain(
    "Current group locations may be unavailable on this phone.",
  );
  expect(JSON.stringify(root.container.toJSON())).not.toContain("location history");

  queryResult = {
    ...queryResult,
    data: [family([{ role: "MEMBER", userId: "user-1" }])],
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
  expect(rendered).toContain("Some location history isn’t available on this phone");
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
  const warning = "Some location history isn’t available on this phone";
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  const [dismiss] = root.container.queryAll((item) => item.type === "pressable");
  if (!dismiss) throw new Error("Dismiss button not found");
  await act(async () => (dismiss.props as { onPress: () => void }).onPress());
  expect(JSON.stringify(root.container.toJSON())).not.toContain(warning);
  expect(storedValues.get("recovery.historyWarningDismissedFrom.user-1.group-1")).toBe(
    new Date("2026-10-03T12:00:00Z").getTime(),
  );
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

test("shows the partial history warning again when more history becomes unreadable", async () => {
  storedValues.set(
    "recovery.historyWarningDismissedFrom.user-1.group-1",
    new Date("2026-10-03T12:00:00Z").getTime(),
  );
  keyAccess = [
    {
      data: { current: "available", history: { partialFrom: new Date("2026-09-01T12:00:00Z") } },
      isError: false,
    },
  ];
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  expect(JSON.stringify(root.container.toJSON())).toContain(
    "Some location history isn’t available on this phone",
  );
  await act(async () => root.unmount());
});

test("does not redirect from an unfocused group screen when the group leaves the list", async () => {
  isFocused = false;
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  queryResult = { ...queryResult, data: [] };
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

test("returns to groups once a fresh list confirms the group is gone", async () => {
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  queryResult = { ...queryResult, data: [] };
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(fetchQuery).toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith("/(tabs)/groups/list");
  await act(async () => {
    root.unmount();
  });
});

test("stays when a fresh list still contains a group the cached list was missing", async () => {
  groups = [{ id: "group-1" }];
  queryResult = { ...queryResult, data: [] };
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

test("shows loading rather than not found while checking a group missing from the cache", async () => {
  fetchGroups = () => new Promise(() => {});
  queryResult = { ...queryResult, data: [] };
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  const rendered = JSON.stringify(root.container.toJSON());
  expect(rendered).toContain("Loading");
  expect(rendered).not.toContain("We couldn’t load this group.");
  await act(async () => {
    root.unmount();
  });
});

test("says the group couldn't be loaded when it can't be checked, for example offline", async () => {
  fetchGroups = async () => {
    throw new Error("Network request failed");
  };
  queryResult = { ...queryResult, data: [] };
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  expect(JSON.stringify(root.container.toJSON())).toContain("We couldn’t load this group.");
  expect(replace).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test("tries the check again from not found once the connection is back", async () => {
  fetchGroups = async () => {
    throw new Error("Network request failed");
  };
  queryResult = { ...queryResult, data: [] };
  const root = createRoot();
  await act(async () => {
    root.render(<GroupScreen />);
  });
  fetchGroups = async () => [];
  const [tryAgain] = root.container.queryAll((item) => item.type === "pressable");
  if (!tryAgain) throw new Error("Try again button not found");
  await act(async () => (tryAgain.props as { onPress: () => void }).onPress());
  expect(fetchQuery).toHaveBeenCalledTimes(2);
  expect(replace).toHaveBeenCalledWith("/(tabs)/groups/list");
  await act(async () => {
    root.unmount();
  });
});

test("opening another group starts from a fresh screen", async () => {
  keyAccess = [
    {
      data: { current: "available", history: { partialFrom: new Date("2026-10-03T12:00:00Z") } },
      isError: false,
    },
  ];
  queryResult = { data: [family([]), family([], "group-2")], isPending: false };
  const warning = "Some location history isn’t available on this phone";
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  const [dismiss] = root.container.queryAll((item) => item.type === "pressable");
  if (!dismiss) throw new Error("Dismiss button not found");
  await act(async () => (dismiss.props as { onPress: () => void }).onPress());
  await act(async () => selectedTab?.onValueChange("settings"));
  expect(selectedTab?.value).toBe("settings");

  routeGroupId = "group-2";
  await act(async () => root.render(<GroupScreen />));

  expect(JSON.stringify(root.container.toJSON())).toContain(warning);
  expect(selectedTab?.value).toBe("members");
  await act(async () => root.unmount());
});

test("keeps history unread after a failed load, then marks only displayed activity seen", async () => {
  const root = createRoot();
  await act(async () => root.render(<GroupScreen />));
  await act(async () => selectedTab?.onValueChange("history"));
  expect(JSON.stringify(root.container.toJSON())).toContain("Couldn’t load history");
  expect(storedValues.get("groupHistory.seenAt.user-1.group-1")).toBeUndefined();

  const displayedAt = new Date(latestAt.getTime() - 60_000);
  historyResult = {
    data: {
      pages: [
        {
          items: [
            {
              kind: "group",
              id: "rename",
              at: displayedAt,
              type: "GROUP_RENAMED",
              actor: { userId: "user-2", name: "Sam" },
              subject: null,
              name: "Family",
              previousName: null,
              emoji: null,
              role: null,
            },
          ],
          nextBefore: null,
        },
      ],
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
  };
  await act(async () => root.render(<GroupScreen />));
  expect(JSON.stringify(root.container.toJSON())).toContain("Sam renamed the group");
  expect(storedValues.get("groupHistory.seenAt.user-1.group-1")).toBe(displayedAt.getTime());
  await act(async () => root.unmount());

  const hidden = createRoot();
  await act(async () =>
    hidden.render(<HistoryTab groupId="group-2" active={false} latestAt={null} />),
  );
  expect(storedValues.get("groupHistory.seenAt.user-1.group-2")).toBeUndefined();
  isFocused = false;
  await act(async () => hidden.render(<HistoryTab groupId="group-2" active latestAt={null} />));
  expect(storedValues.get("groupHistory.seenAt.user-1.group-2")).toBeUndefined();
  isFocused = true;
  await act(async () => hidden.render(<HistoryTab groupId="group-2" active latestAt={null} />));
  expect(storedValues.get("groupHistory.seenAt.user-1.group-2")).toBe(displayedAt.getTime());
  await act(async () => hidden.unmount());
});
