import { expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";
import type { submitEpochChange } from "../lib/groupEncryption.ts";
import type { MapMemberDevice } from "../lib/mapPeopleTypes.ts";
import type { LiveMapPosition } from "../lib/mapTrackingTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let pending = true;
let records: Record<string, { name: string | null; ciphertext: string }> = {};
let buttons: { label: string; disabled: boolean; onPress: () => void }[] = [];
let input = "";
let positions: LiveMapPosition[] = [];
let memberDevices: MapMemberDevice[] = [];
const mutate = mock(async (_input: unknown) => {});
const group = {
  id: "group",
  members: [{ id: "member", role: "MEMBER", userId: "other", name: "Alice", image: null }],
};
const passthrough = ({ children }: { children?: ReactNode }) =>
  React.createElement(React.Fragment, null, children);
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ mutateAsync: mutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: (options: { queryKey?: unknown[]; select?: (groups: unknown[]) => unknown }) =>
    options.queryKey?.[0] === "personalNicknames"
      ? { data: records, isPending: pending, isFetching: pending, isError: false }
      : options.queryKey?.[0] === "memberDevices"
        ? { data: memberDevices, isPending: false }
        : { data: options.select?.([group]), isPending: false },
}));
mock.module("expo-router", () => ({ useRouter: () => ({ replace: () => {} }) }));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("lucide-react-native", () => ({
  MapPinIcon: () => null,
  PlusCircleIcon: () => null,
  BackpackIcon: () => null,
  Flower2Icon: () => null,
  HeartIcon: () => null,
  StarIcon: () => null,
  SunIcon: () => null,
  TabletIcon: () => null,
  CarIcon: () => null,
  createLucideIcon: () => () => null,
  HouseIcon: () => null,
  LaptopIcon: () => null,
  SmartphoneIcon: () => null,
  TagIcon: () => null,
  WatchIcon: () => null,
}));
mock.module("react-native", () => ({
  View: ({ accessibilityLabel, children }: { accessibilityLabel?: string; children?: ReactNode }) =>
    React.createElement("view", { accessibilityLabel }, children),
  ScrollView: passthrough,
  Pressable: passthrough,
  ActivityIndicator: () => null,
  Alert: { alert: () => {} },
  TextInput: ({
    value,
    onChangeText,
  }: {
    value: string;
    onChangeText: (value: string) => void;
  }) => {
    input = value;
    changeInput = onChangeText;
    return null;
  },
}));
let changeInput: (value: string) => void = () => {};
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({
    children,
    disabled = false,
    onPress,
  }: {
    children: React.ReactElement<{ children: string }>;
    disabled?: boolean;
    onPress: () => void;
  }) => {
    buttons.push({ label: children.props.children, disabled, onPress });
    return null;
  },
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: passthrough }));
mock.module("../components/ui/Dialog.tsx", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogContent: passthrough,
  DialogHeader: passthrough,
  DialogTitle: passthrough,
}));
mock.module("../components/ui/Avatar.tsx", () => ({
  Avatar: passthrough,
  AvatarFallback: passthrough,
  AvatarImage: () => null,
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/dialogs/InviteMemberToGroupDialog.tsx", () => ({
  InviteMemberToGroupDialog: () => null,
}));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../hooks/useLiveTrackingPositions.ts", () => ({
  useLiveTrackingPositions: () => ({ positions, status: { undecryptable: [] } }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    groupMembership: {
      list: { queryOptions: () => ({}), queryKey: () => [] },
      listMemberDevices: { queryOptions: () => ({ queryKey: ["memberDevices"] }) },
      remove: { mutationOptions: () => ({}) },
      updateRole: { mutationOptions: () => ({}) },
      updateNickname: { mutationOptions: () => ({}) },
    },
    groupLifecycle: { delete: { mutationOptions: () => ({}) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "owner" } } }) },
}));
mock.module("../lib/personalNicknames.ts", () => ({
  loadPersonalNicknames: async () => records,
  encryptPersonalNickname: async () => "new-ciphertext",
}));
mock.module("../lib/groupEncryption.ts", () => ({
  buildRemoveGroupMemberInput: async () => ({}),
  submitEpochChange: (async ({ build, submit }) =>
    submit(await build())) satisfies typeof submitEpochChange,
}));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("../lib/hiddenMapGroups.ts", () => ({ forgetHiddenMapGroup: () => {} }));
mock.module("../lib/batteryVisual.ts", () => ({
  getBatteryVisual: () => ({ colorClass: "", icon: () => null }),
}));
mock.module("../lib/timeSince.ts", () => ({ timeSince: () => "2 minutes ago" }));
const { default: MembersTab } = await import("../app/(tabs)/groups/[groupId]/MembersTab.tsx");
const button = (label: string) => buttons.findLast((item) => item.label === label)!;

test("waits for loaded nicknames before opening the editor", async () => {
  const root = createRoot();
  pending = true;
  records = {};
  buttons = [];
  await act(async () => root.render(<MembersTab groupId="group" />));
  expect(button("Edit nickname").disabled).toBe(true);
  await act(async () => button("Edit nickname").onPress());
  expect(buttons.some((item) => item.label === "Save nickname")).toBe(false);
  pending = false;
  records = { member: { name: "Gran", ciphertext: "saved" } };
  buttons = [];
  await act(async () => root.render(<MembersTab groupId="group" />));
  await act(async () => button("Edit nickname").onPress());
  expect(input).toBe("Gran");
  await act(async () => root.unmount());
});

test("keeps an unreadable nickname on blank save and replaces it when a new nickname is entered", async () => {
  const root = createRoot();
  pending = false;
  records = { member: { name: null, ciphertext: "old" } };
  buttons = [];
  mutate.mockClear();
  await act(async () => root.render(<MembersTab groupId="group" />));
  await act(async () => button("Edit nickname").onPress());
  await act(async () => button("Save nickname").onPress());
  expect(mutate).not.toHaveBeenCalled();
  await act(async () => button("Edit nickname").onPress());
  await act(async () => changeInput("Mum"));
  await act(async () => button("Save nickname").onPress());
  expect(mutate).toHaveBeenCalledWith({
    groupId: "group",
    memberId: "member",
    ciphertext: "new-ciphertext",
    expectedCiphertext: "old",
  });
  await act(async () => root.unmount());
});

test("each of a member's devices is read out as one line", async () => {
  const root = createRoot();
  pending = false;
  records = {};
  const position = {
    latitude: 51.5,
    longitude: -0.1,
    sourceGroupId: "group",
    speed: null,
    timestamp: "2026-11-11T12:00:00.000Z",
    userId: "other",
  };
  positions = [
    { ...position, battery: { charging: false, level: 80 }, deviceId: "phone" },
    { ...position, battery: { charging: true, level: 35 }, deviceId: "tablet" },
  ];
  memberDevices = [
    { deviceId: "phone", icon: "phone", name: "Pixel", platform: "android", userId: "other" },
    { deviceId: "tablet", icon: "tablet", name: "iPad", platform: "ios", userId: "other" },
  ];
  await act(async () => root.render(<MembersTab groupId="group" />));
  const labels = root.container
    .queryAll((item) => item.type === "view")
    .map((item) => (item.props as { accessibilityLabel?: string }).accessibilityLabel)
    .filter(Boolean);
  expect(labels).toEqual([
    "Pixel, updated 2 minutes ago, battery 80%",
    "iPad, updated 2 minutes ago, battery 35%",
  ]);
  positions = [];
  memberDevices = [];
  await act(async () => root.unmount());
});
