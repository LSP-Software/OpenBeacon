import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type QueryState = {
  data: unknown;
  isError: boolean;
  isFetching: boolean;
  isPending: boolean;
  refetch: () => Promise<void>;
};
const refetched: string[] = [];
const query = (name: string, state: Partial<QueryState>): QueryState => ({
  data: undefined,
  isError: false,
  isFetching: false,
  isPending: false,
  refetch: async () => {
    refetched.push(name);
  },
  ...state,
});
let queries: Record<string, QueryState>;
mock.module("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: [string] }) => queries[queryKey[0]],
  useQueryClient: () => ({}),
  useMutation: () => ({}),
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("expo-router", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: unknown }) =>
    React.createElement("router-link", { href }, children),
}));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) =>
    React.createElement("view", null, children),
}));
mock.module("lucide-react-native", () => ({
  ChevronRightIcon: () => null,
  PlusIcon: () => null,
  ShieldIcon: () => null,
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    groupMembership: {
      list: { queryOptions: () => ({ queryKey: ["groups"] }), queryKey: () => ["groups"] },
    },
    groupInvites: {
      list: { queryOptions: () => ({ queryKey: ["invites"] }), queryKey: () => ["invites"] },
      joinAlerts: {
        queryOptions: () => ({ queryKey: ["joinAlerts"] }),
        queryKey: () => ["joinAlerts"],
      },
      dismissJoinAlert: { mutationOptions: () => ({}) },
    },
  },
}));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/groupColor.ts", () => ({ getGroupColor: () => "#000000" }));
mock.module("../hooks/useRefetchWhileFocused.ts", () => ({ useRefetchWhileFocused: () => {} }));
mock.module("../hooks/useGroupColorRevision.ts", () => ({ useGroupColorRevision: () => 0 }));
mock.module("../components/dialogs/CreateGroupDialog.tsx", () => ({
  CreateGroupDialog: () => null,
}));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => "Loading" }));
mock.module("../components/RefreshablePage.tsx", () => ({
  RefreshablePage: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
    React.createElement("pressable", { onPress }, children),
}));
const Host = ({ children }: { children?: React.ReactNode }) =>
  React.createElement("view", null, children);
mock.module("../components/ui/Avatar.tsx", () => ({
  Avatar: Host,
  AvatarFallback: Host,
  AvatarImage: () => null,
}));
mock.module("../components/ui/Card.tsx", () => ({
  Card: Host,
  CardDescription: Host,
  CardHeader: Host,
  CardTitle: Host,
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) => children,
}));

const { default: GroupsScreen } = await import("../app/(tabs)/groups/list.tsx");

const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<GroupsScreen />));
  return root;
};

beforeEach(() => {
  refetched.length = 0;
  queries = {
    groups: query("groups", { data: [] }),
    invites: query("invites", { data: [] }),
    joinAlerts: query("joinAlerts", { data: [] }),
  };
});

test("a failed first load offers a retry instead of saying there are no groups", async () => {
  queries["groups"] = query("groups", { isError: true });
  const root = await render();
  const output = JSON.stringify(root.container.toJSON());
  expect(output).toContain("We couldn’t load your groups");
  expect(output).not.toContain("Your Groups");

  const retry = root.container.queryAll((node) => node.type === "pressable").at(-1);
  const onPress = retry?.props["onPress"];
  if (typeof onPress !== "function") throw new Error("Missing retry button");
  await act(async () => onPress());
  expect(refetched).toEqual(["groups", "invites"]);
});

test("a failed refresh keeps the groups already shown and says they may be out of date", async () => {
  queries["groups"] = query("groups", {
    data: [{ id: "group-1", name: "Family", image: null, members: [] }],
    isError: true,
  });
  const output = JSON.stringify((await render()).container.toJSON());
  expect(output).toContain("Family");
  expect(output).toContain("may be out of date");
});

test("an empty list with no errors shows the normal page", async () => {
  const output = JSON.stringify((await render()).container.toJSON());
  expect(output).toContain("Your Groups");
  expect(output).not.toContain("out of date");
  expect(output).not.toContain("couldn’t load");
});

test("an invite card names the group and opens the invite", async () => {
  queries["invites"] = query("invites", {
    data: [
      {
        id: "invite-1",
        inviter: { id: "user-2", name: "Alex", image: null },
        group: { id: "group-1", name: "Smith Family", image: null },
      },
    ],
  });
  const root = await render();
  const output = JSON.stringify(root.container.toJSON());
  expect(output).toContain("You’ve been sent an invite to ");
  expect(output).toContain("Smith Family");
  expect(output).toContain("View invite");
  expect(output).not.toContain("Alex");
  const links = root.container.queryAll((node) => node.type === "router-link");
  expect(links.map((link) => link.props["href"])).toContainEqual({
    pathname: "/join",
    params: { inviteId: "invite-1" },
  });
});
