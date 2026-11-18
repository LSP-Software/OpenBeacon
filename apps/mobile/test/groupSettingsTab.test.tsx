import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: { title: string; message: string }[] = [];
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const host =
  (type: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(type, props, children);

mock.module("expo-router", () => ({ useRouter: () => ({ replace: () => {} }) }));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-native", () => ({ TextInput: host("text-input"), View }));
mock.module("../components/HistoryShareChoices.tsx", () => ({ HistoryShareChoices: () => null }));
mock.module("../components/map/GroupMapColorPicker.tsx", () => ({
  GroupMapColorPicker: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: host("mock-button") }));
mock.module("../components/ui/Switch.tsx", () => ({ Switch: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../hooks/useCachedGroup.ts", () => ({
  useCachedGroup: () => ({
    group: { name: "Family", members: [{ userId: "user-1", role: "OWNER" }] },
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
    groupMembership: { list: { queryKey: () => [] } },
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
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));

const { default: SettingsTab } = await import("../components/groups/SettingsTab.tsx");

let root: Root;
beforeEach(async () => {
  alerts.length = 0;
  root = createRoot();
  await act(async () => root.render(<SettingsTab groupId="group-1" />));
});

test("the rename field starts with the group's current name", async () => {
  const [input] = root.container.queryAll((item) => item.type === "text-input");
  expect((input!.props as { value: string }).value).toBe("Family");
  await act(async () => root.unmount());
});

test("deleting the group calls what is lost location history", async () => {
  const deleteButton = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Delete group"));
  await act(async () => (deleteButton!.props as { onPress: () => void }).onPress());
  await act(async () => root.unmount());

  expect(alerts).toEqual([
    {
      title: "Delete group?",
      message: "This permanently deletes the group and its location history for all members.",
    },
  ]);
});
