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

type Settings = NonNullable<typeof query.data>;
type Change = {
  type: keyof typeof notificationTypes;
  channel: "email" | "phone";
  enabled: boolean;
};
let mutationOptions: {
  onMutate: (change: Change) => Promise<{ previous: boolean | null | undefined }>;
  onSuccess: (data: Settings) => void;
  onError: (
    error: Error,
    change: Change,
    context: { previous: boolean | null | undefined } | undefined,
  ) => void;
  networkMode?: string;
} | null = null;
let cached: Settings | undefined;
let mutating = 0;
const alerts: string[] = [];
const queryClient = {
  cancelQueries: async () => {},
  getQueryData: () => cached,
  setQueryData: (_key: unknown, data: Settings) => {
    cached = data;
  },
  isMutating: () => mutating,
};

mock.module("@tanstack/react-query", () => ({
  useMutation: (options: NonNullable<typeof mutationOptions>) => {
    mutationOptions = options;
    return { isPending: false, mutate };
  },
  useMutationState: () => [],
  useQuery: () => ({ ...query, isError: false, isPending: false }),
  useQueryClient: () => queryClient,
}));
mock.module("react-native", () => ({ ScrollView: View, View }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("lucide-react-native", () => ({ BellOffIcon: View }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/PromptCard.tsx", () => ({
  PromptCard: ({ title }: { title: string }) => React.createElement("prompt-card", { title }),
}));
mock.module("../components/headers/ScreenHeader.tsx", () => ({ ScreenHeader: () => null }));
mock.module("../components/ui/List.tsx", () => ({
  ListSection: ({ footer, children }: { footer?: React.ReactNode; children?: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
  ListRow: ({
    title,
    subtitle,
    trailing,
  }: {
    title: string;
    subtitle?: string;
    trailing?: React.ReactNode;
  }) => (
    <>
      {title}
      {subtitle}
      {trailing}
    </>
  ),
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: View }));
mock.module("../components/ui/Switch.tsx", () => ({
  Switch: (props: { accessibilityLabel: string; value: boolean }) =>
    React.createElement("mock-switch", props),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (title: string) => {
      alerts.push(title);
    },
  },
}));
mock.module("../lib/notifications.ts", () => ({
  useNotificationSettings: () => ({ ...notificationsOn, turnOn: () => {}, turningOn: false }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    notificationSettings: {
      get: { queryKey: () => ["get"], queryOptions: () => ({}) },
      set: { mutationKey: () => ["set"], mutationOptions: (options: unknown) => options },
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
    "Place arrivals and departures, phone",
    "Someone joined a group, phone",
    "Someone left or was removed, phone",
    "Role changed, phone",
    ...[
      "New sign-in",
      "Password changed or reset",
      "Recovery phrase changed or reset",
      "Other sessions signed out",
      "Device removed",
      "Account deletion scheduled",
    ].flatMap((label) => [`${label}, email`, `${label}, phone`]),
  ]);
  expect(
    switches.find(({ accessibilityLabel }) => accessibilityLabel.startsWith("Role"))?.value,
  ).toBe(false);
  expect(text).toContain("Turning any of these off sends an email to your account’s address.");

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
  expect(text).toContain("When a new phone or tablet signs in to your account.");
});

test("a setting a newer server added is left out instead of breaking the screen", async () => {
  const known = settingsFor(false);
  query.data = {
    ...known,
    settings: [
      ...known.settings,
      {
        type: "SEAT_LIMIT_REACHED" as keyof typeof notificationTypes,
        email: null,
        phone: true,
      },
    ],
  };
  const { switches } = await render();

  expect(switches).toHaveLength(Object.keys(notificationTypes).length);
});

test("the Notifications are off card shows only when this phone's notifications are off", async () => {
  query.data = settingsFor(true);
  expect((await render()).cards).toHaveLength(0);
  notificationsOn.enabled = false;
  expect((await render()).cards).toHaveLength(1);
});

test("a failed change rolls back only its own switch and a slow reply doesn't undo a newer change", async () => {
  query.data = settingsFor(true);
  await render();
  const options = mutationOptions;
  if (!options) throw new Error("No mutation");
  expect(options.networkMode).toBe("always");
  cached = settingsFor(true);
  const phoneOf = (type: keyof typeof notificationTypes) =>
    cached?.settings.find((setting) => setting.type === type)?.phone;

  const signIn: Change = { type: "NEW_SIGN_IN", channel: "phone", enabled: false };
  const joined: Change = { type: "MEMBER_JOINED", channel: "phone", enabled: false };
  const signInContext = await options.onMutate(signIn);
  const joinedContext = await options.onMutate(joined);
  mutating = 2;
  expect(phoneOf("NEW_SIGN_IN")).toBe(false);
  expect(phoneOf("MEMBER_JOINED")).toBe(false);

  options.onError(new Error("offline"), signIn, signInContext);
  expect(phoneOf("NEW_SIGN_IN")).toBe(true);
  expect(phoneOf("MEMBER_JOINED")).toBe(false);
  expect(alerts).toEqual(["Couldn’t save your notification settings"]);

  options.onSuccess(settingsFor(true));
  expect(phoneOf("MEMBER_JOINED")).toBe(false);
  mutating = 1;
  const saved = settingsFor(true);
  options.onSuccess({
    ...saved,
    settings: saved.settings.map((setting) =>
      setting.type === "MEMBER_JOINED" ? { ...setting, phone: false } : setting,
    ),
  });
  expect(phoneOf("MEMBER_JOINED")).toBe(false);
  expect(joinedContext.previous).toBe(true);
});
