import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: { title: string; message: string }[] = [];
let members: { id: string; userId: string; role: "OWNER" | "ADMIN" | "MEMBER"; name: string }[] =
  [];
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const host =
  (type: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(type, props, children);

mock.module("expo-router", () => ({ useRouter: () => ({ dismissTo: () => {} }) }));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("@tanstack/react-query", () => ({
  skipToken: Symbol("skipToken"),
  useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
  useQuery: () => ({ data: {} }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  Pressable: View,
  ScrollView: View,
  TextInput: host("text-input"),
  View,
}));
mock.module("../components/ui/Dialog.tsx", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? React.createElement("mock-dialog", null, children) : null,
  DialogContent: View,
  DialogHeader: View,
  DialogTitle: View,
}));
mock.module("../components/HistoryShareChoices.tsx", () => ({ HistoryShareChoices: () => null }));
mock.module("../components/map/GroupMapColorPicker.tsx", () => ({
  GroupMapColorPicker: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: host("mock-button") }));
mock.module("../components/ui/Switch.tsx", () => ({ Switch: () => null }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/List.tsx", () => ({ ListRow: View, ListSection: View }));
mock.module("../components/image/GroupImage.tsx", () => ({ GroupImage: () => null }));
mock.module("lucide-react-native", () => ({
  LogOutIcon: () => null,
  MapIcon: () => null,
  Trash2Icon: () => null,
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../hooks/useCachedGroup.ts", () => ({
  useCachedGroup: () => ({
    group: { name: "Family", members },
    groupCount: 1,
  }),
}));
mock.module("../hooks/useHistoryShare.ts", () => ({ useHistoryShare: () => ({ setting: null }) }));
mock.module("../hooks/useHiddenMapGroupIds.ts", () => ({ useHiddenMapGroupIds: () => [] }));
mock.module("../lib/alert.ts", () => ({
  Alert: { alert: (title: string, message: string) => alerts.push({ title, message }) },
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    groupLifecycle: { delete: { mutationOptions: () => ({}) } },
    groupMembership: { list: { queryKey: () => [] }, remove: { mutationOptions: () => ({}) } },
    groupSettings: { rename: { mutationOptions: () => ({}) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
mock.module("../lib/hiddenMapGroups.ts", () => ({
  forgetHiddenMapGroup: () => {},
  setMapGroupHidden: () => {},
}));
mock.module("../lib/mapGroupVisibility.ts", () => ({ canHideMapGroups: () => false }));
mock.module("../lib/personalNicknames.ts", () => ({ loadPersonalNicknames: async () => ({}) }));
mock.module("../lib/groupEncryption.ts", () => ({
  buildRemoveGroupMemberInput: async () => ({}),
  submitEpochChange: async () => ({}),
}));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));

const { default: SettingsTab } = await import("../components/groups/SettingsTab.tsx");

const owner = { id: "member-1", userId: "user-1", role: "OWNER", name: "Sam" } as const;
const other = { id: "member-2", userId: "user-2", role: "MEMBER", name: "Alex" } as const;

let root: Root;
const render = async (groupMembers: typeof members) => {
  members = groupMembers;
  root = createRoot();
  await act(async () => root.render(<SettingsTab groupId="group-1" />));
};
const button = (label: string) =>
  root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes(label));
const press = (label: string) =>
  act(async () => (button(label)!.props as { onPress: () => void }).onPress());

beforeEach(async () => {
  alerts.length = 0;
  await render([owner]);
});

test("the rename field starts with the group's current name", async () => {
  const [input] = root.container.queryAll((item) => item.type === "text-input");
  expect((input!.props as { value: string }).value).toBe("Family");
  await act(async () => root.unmount());
});

test("deleting the group calls what is lost location history", async () => {
  await press("Delete group");
  await act(async () => root.unmount());

  expect(alerts).toEqual([
    {
      title: "Delete group?",
      message: "This permanently deletes the group and its location history for all members.",
    },
  ]);
});

test("a member can leave from Settings but cannot delete the group", async () => {
  await act(async () => root.unmount());
  await render([
    { ...owner, userId: "user-2" },
    { ...other, userId: "user-1" },
  ]);

  expect(button("Delete group")).toBeUndefined();
  await press("Leave group");
  await act(async () => root.unmount());

  expect(alerts).toEqual([
    {
      title: "Leave group?",
      message:
        "You will leave this group, and your location history in this group will be deleted.",
    },
  ]);
});

test("the only owner leaving from Settings is asked to choose a new owner first", async () => {
  await act(async () => root.unmount());
  await render([owner, other]);

  expect(button("Delete group")).toBeDefined();
  await press("Leave group");
  const dialog = root.container.queryAll((item) => item.type === "mock-dialog");
  await act(async () => root.unmount());

  expect(dialog).toHaveLength(1);
  expect(alerts).toEqual([]);
});
