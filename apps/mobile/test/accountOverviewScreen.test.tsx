import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type AlertAction = { text: string; style?: string; onPress?: () => void };

const alerts: { title: string; actions: AlertAction[] }[] = [];
const replace = mock((_route: string) => {});
const signOutOfThisPhone = mock(
  async (_input: {
    onSigningOut: () => void;
    removeThisPhone: boolean;
    sessionTokenToRevoke: string | null;
  }): Promise<{ status: "phoneRemoved" | "signedOut" | "serverUnreachable" }> => ({
    status: "signedOut",
  }),
);

mock.module("../components/LocationSharingCard.tsx", () => ({ LocationSharingCard: () => null }));

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const query = { data: undefined, isError: false };
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("expo-router", () => ({
  Link: View,
  router: { push: () => {}, replace },
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: async () => {} }),
  useQuery: () => query,
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-hook-form", () => ({
  useForm: () => ({ control: {}, handleSubmit: () => () => {}, reset: () => {} }),
}));
mock.module("@hookform/resolvers/zod", () => ({ zodResolver: () => {} }));
mock.module("lucide-react-native", () =>
  Object.fromEntries(
    [
      "BellIcon",
      "BellOffIcon",
      "CameraIcon",
      "HelpCircleIcon",
      "HistoryIcon",
      "InfoIcon",
      "KeyRoundIcon",
      "LockIcon",
      "MailIcon",
      "MapPinIcon",
      "SmartphoneIcon",
      "SunIcon",
      "Trash2Icon",
    ].map((name) => [name, () => null]),
  ),
);
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  Pressable: View,
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/containers/settingsContainer.tsx", () => ({
  SettingsContainer: () => null,
}));
mock.module("../components/image/ProfileImage.tsx", () => ({ ProfileImage: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Card.tsx", () => ({
  Card: View,
  CardContent: View,
  CardDescription: View,
  CardHeader: View,
  CardTitle: View,
}));
mock.module("../components/ui/Dialog.tsx", () => ({
  Dialog: View,
  DialogContent: View,
  DialogHeader: View,
  DialogTitle: View,
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Input.tsx", () => ({ Input: () => null }));
mock.module("../components/ui/Separator.tsx", () => ({ Separator: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../hooks/useHeldHistoryKeyVersions.ts", () => ({
  useHeldHistoryKeyVersions: () => query,
}));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (title: string, _message: string, actions: AlertAction[] = []) => {
      alerts.push({ title, actions });
    },
  },
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    account: {
      listDevices: { queryOptions: () => ({}) },
      updateName: { mutationOptions: () => ({}) },
    },
    accountRecovery: { status: { queryOptions: () => ({}) } },
    auth: { providers: { queryOptions: () => ({}) } },
    groupMembership: { list: { queryKey: () => [], queryOptions: () => ({}) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: {
    useSession: () => ({
      data: { session: { token: "token" }, user: { email: "a@b.c", id: "user-1", name: "A" } },
      refetch: async () => {},
    }),
  },
}));
mock.module("../lib/deviceKeys.ts", () => ({ getStoredDeviceId: () => "device-1" }));
mock.module("../lib/historyLossRisk.ts", () => ({ historyLossRisk: () => "none" }));
mock.module("../lib/locationPermissions.ts", () => ({
  getLocationPermissionWarningDescription: () => "",
  getLocationPermissionWarningTitle: () => "",
}));
mock.module("../lib/notifications.ts", () => ({
  requestNotificationPermissions: async () => "granted",
  useNotificationsEnabled: () => ({ enabled: true, refresh: async () => {} }),
}));
mock.module("expo-linking", () => ({ openSettings: async () => {} }));
mock.module("../lib/restoreReminders.ts", () => ({
  dismissRestoreCard: () => {},
  isRestoreCardDismissed: () => false,
}));
mock.module("../lib/storage.ts", () => ({ storage: { getBoolean: () => false, set: () => {} } }));
mock.module("../providers/LocationPermissionProvider.tsx", () => ({
  useLocationPermissions: () => ({
    openLocationPermissionSettings: () => {},
    permissionState: null,
  }),
}));
mock.module("../lib/signOut.ts", () => ({ signOutOfThisPhone }));

const { default: AccountScreen } = await import("../app/(tabs)/account/overview.tsx");

let root: Root | null = null;

const press = async (title: string, text: string) => {
  const alert = alerts.findLast((item) => item.title === title);
  const action = alert?.actions.find((item) => item.text === text);
  if (!action?.onPress) throw new Error(`Missing ${text} in ${title}`);
  await act(async () => action.onPress?.());
};

const removeThisPhoneWithoutAnswer = async () => {
  signOutOfThisPhone.mockImplementationOnce(async () => ({ status: "serverUnreachable" }));
  root = createRoot();
  await act(async () => root?.render(<AccountScreen />));
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Sign out"));
  if (!button) throw new Error("Sign out button not found");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  await press("Sign out?", "Also remove this phone from your account");
};

const removeCalls = () => signOutOfThisPhone.mock.calls.map(([input]) => input.removeThisPhone);

beforeEach(() => {
  alerts.length = 0;
  replace.mockClear();
  signOutOfThisPhone.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("removing this phone without reaching the server offers Cancel, sign out without removing, and Try again", async () => {
  await removeThisPhoneWithoutAnswer();

  expect(alerts.at(-1)?.title).toBe("Couldn’t reach the server");
  expect(alerts.at(-1)?.actions.map(({ text }) => text)).toEqual([
    "Cancel",
    "Sign out without removing",
    "Try again",
  ]);
  expect(replace).not.toHaveBeenCalled();
});

test("Try again tries to remove this phone again", async () => {
  await removeThisPhoneWithoutAnswer();
  signOutOfThisPhone.mockImplementationOnce(async () => ({ status: "phoneRemoved" }));
  await press("Couldn’t reach the server", "Try again");

  expect(removeCalls()).toEqual([true, true]);
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("Sign out without removing signs out and keeps this phone", async () => {
  await removeThisPhoneWithoutAnswer();
  await press("Couldn’t reach the server", "Sign out without removing");

  expect(removeCalls()).toEqual([true, false]);
  expect(alerts.map(({ title }) => title)).not.toContain("This phone is still in Devices");
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("Cancel leaves the user signed in", async () => {
  await removeThisPhoneWithoutAnswer();
  const cancel = alerts.at(-1)?.actions.find(({ text }) => text === "Cancel");

  expect(cancel?.style).toBe("cancel");
  expect(cancel?.onPress).toBeUndefined();
  expect(removeCalls()).toEqual([true]);
  expect(replace).not.toHaveBeenCalled();
});

test("tapping Try again twice only starts one sign-out", async () => {
  await removeThisPhoneWithoutAnswer();
  const tryAgain = alerts.at(-1)?.actions.find(({ text }) => text === "Try again");
  await act(async () => {
    tryAgain?.onPress?.();
    tryAgain?.onPress?.();
  });

  expect(removeCalls()).toEqual([true, true]);
});
