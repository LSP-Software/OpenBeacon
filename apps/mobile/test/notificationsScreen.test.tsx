import { beforeEach, expect, mock, test } from "bun:test";
import { notificationTypes } from "@openbeacon/schemas";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const mutate = mock((_change: unknown) => {});
const notificationsOn: { enabled: boolean | null } = { enabled: true };
const query: {
  data:
    | {
        canSendEmail: boolean;
        settings: { type: keyof typeof notificationTypes; email: boolean | null; phone: boolean }[];
      }
    | undefined;
} = { data: undefined };

mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutate }),
  useQuery: () => ({ ...query, isError: false, isPending: false }),
  useQueryClient: () => ({}),
}));
mock.module("react-native", () => ({ ScrollView: View, View }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("lucide-react-native", () => ({ BellOffIcon: View }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/PromptCard.tsx", () => ({
  PromptCard: ({ title }: { title: string }) => React.createElement("prompt-card", { title }),
}));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/ui/Button.tsx", () => ({ Button: View }));
mock.module("../components/ui/Switch.tsx", () => ({
  Switch: (props: { accessibilityLabel: string; value: boolean }) =>
    React.createElement("mock-switch", props),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/notifications.ts", () => ({
  useNotificationSettings: () => ({ ...notificationsOn, turnOn: () => {}, turningOn: false }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    notificationSettings: {
      get: { queryKey: () => ["get"], queryOptions: () => ({}) },
      set: { mutationOptions: () => ({}) },
    },
  },
}));

const { default: NotificationsScreen } = await import("../app/account/notifications.tsx");

const settingsFor = (canSendEmail: boolean) => ({
  canSendEmail,
  settings: (Object.keys(notificationTypes) as (keyof typeof notificationTypes)[]).map((type) => ({
    type,
    email: notificationTypes[type].hasEmail ? true : null,
    phone: notificationTypes[type].defaultOn,
  })),
});

const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<NotificationsScreen />));
  const switches = root.container.queryAll((item) => item.type === "mock-switch");
  const text = JSON.stringify(root.container.children);
  const cards = root.container.queryAll((item) => item.type === "prompt-card");
  await act(async () => root.unmount());
  return {
    cards,
    switches: switches.map(
      (item) =>
        item.props as {
          accessibilityLabel: string;
          value: boolean;
          onValueChange: (v: boolean) => void;
        },
    ),
    text,
  };
};

beforeEach(() => {
  mutate.mockClear();
  notificationsOn.enabled = true;
});

test("with email, security types get an Email and a Phone switch and the rest only Phone", async () => {
  query.data = settingsFor(true);
  const { switches, text } = await render();

  expect(switches.map(({ accessibilityLabel }) => accessibilityLabel)).toEqual([
    "Place arrivals and departures, phone notifications",
    "Someone joined a group, phone notifications",
    "Someone left or was removed, phone notifications",
    "Role changed, phone notifications",
    ...[
      "New sign-in",
      "Password changed or reset",
      "Recovery phrase changed or reset",
      "Other sessions signed out",
      "Device removed",
      "Account deletion scheduled",
    ].flatMap((label) => [`${label}, email`, `${label}, phone notifications`]),
  ]);
  expect(
    switches.find(({ accessibilityLabel }) => accessibilityLabel.startsWith("Role"))?.value,
  ).toBe(false);
  expect(text).toContain("Turning off a security notification sends an email");

  switches
    .find(({ accessibilityLabel }) => accessibilityLabel === "New sign-in, email")
    ?.onValueChange(false);
  expect(mutate).toHaveBeenCalledWith({ type: "NEW_SIGN_IN", channel: "email", enabled: false });
});

test("without email, every type has one switch and nothing mentions email", async () => {
  query.data = settingsFor(false);
  const { switches, text } = await render();

  expect(switches).toHaveLength(Object.keys(notificationTypes).length);
  expect(switches.map(({ accessibilityLabel }) => accessibilityLabel)).toContain("New sign-in");
  expect(text).not.toContain("Email");
  expect(text).not.toContain("sends an email");
});

test("the Notifications are off card shows only when this phone's notifications are off", async () => {
  query.data = settingsFor(true);
  expect((await render()).cards).toHaveLength(0);
  notificationsOn.enabled = false;
  expect((await render()).cards).toHaveLength(1);
});
