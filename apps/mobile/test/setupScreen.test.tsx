import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let deviceActive: boolean | Error = false;
let recoveryKey: object | null = {};
let deviceStatus: { data?: { accountHasActiveDevice?: boolean }; isError: boolean } = {
  data: { accountHasActiveDevice: true },
  isError: false,
};
const refetchDeviceStatus = mock(async () => {});
let signOutError: Error | null = null;
let signOutStatus: "phoneRemoved" | "signedOut" | "serverUnreachable" = "phoneRemoved";
let signOutGate: Promise<void> | null = null;
const replace = mock((_route: string) => {});
const signOutOfThisPhone = mock(
  async (_input: { removeThisPhone: boolean; sessionTokenToRevoke: string | null }) => {
    await signOutGate;
    if (signOutError) throw signOutError;
    return { status: signOutStatus };
  },
);
type AlertButton = { text: string; onPress?: () => void };
const alerts: { title: string; message: string; buttons: AlertButton[] }[] = [];

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Link: ({ children, href }: { children?: React.ReactNode; href: unknown }) =>
    React.createElement("mock-link", { href }, children),
  router: { replace },
  useFocusEffect: (callback: () => void) => useEffect(() => callback(), [callback]),
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string }) =>
    queryKey === "device"
      ? { ...deviceStatus, isPending: !deviceStatus.data, refetch: refetchDeviceStatus }
      : { data: { recoveryKey }, isError: false, isPending: false },
}));
mock.module("react-native", () => ({
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-pressable", { onPress }, children),
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => React.createElement("mock-button", { disabled, onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    accountRecovery: { status: { queryOptions: () => ({ queryKey: "recovery" }) } },
    device: { status: { queryOptions: () => ({ queryKey: "device" }) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { session: { token: "session-token" } } }) },
}));
mock.module("../lib/signOut.ts", () => ({ signOutOfThisPhone }));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (title: string, message: string, buttons: AlertButton[]) => {
      alerts.push({ title, message, buttons });
    },
  },
}));
mock.module("../lib/deviceActivation.ts", () => ({
  isThisDeviceActive: async () => {
    if (deviceActive instanceof Error) throw deviceActive;
    return deviceActive;
  },
}));

let deviceNoun: "phone" | "tablet" = "phone";
mock.module("../lib/thisDeviceNoun.ts", () => ({ thisDeviceNoun: () => deviceNoun }));
const clearPendingJoinCodes = mock(() => {});
mock.module("../lib/pendingJoinCode.ts", () => ({
  clearPendingJoinCodes,
  openAppAfterSetup: (home: string) => replace(home),
}));

const { default: SetUpPhoneScreen } = await import("../app/setup/index.tsx");

let root: Root | null = null;

const render = async () => {
  root = createRoot();
  await act(async () => root?.render(<SetUpPhoneScreen />));
};

const pressCancel = async () => {
  const button = root?.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Cancel and remove this phone"));
  if (!button) throw new Error("Missing Cancel and remove this phone");
  await act(async () => (button.props as { onPress: () => void }).onPress());
};

const pressAlertButton = async (text: string) => {
  const button = alerts.at(-1)?.buttons.find((item) => item.text === text);
  if (!button) throw new Error(`Missing ${text}`);
  await act(async () => button.onPress?.());
};

const cancelSetup = async () => {
  await pressCancel();
  await pressAlertButton("Cancel and remove");
};

const findByText = (type: string, text: string) => {
  const item = root?.container
    .queryAll((candidate) => candidate.type === type)
    .find((candidate) => JSON.stringify(candidate.children).includes(text));
  if (!item) throw new Error(`Missing ${type} ${text}`);
  return item;
};

const continueHref = () => findByText("mock-link", "Continue").props["href"];

const shownText = () => JSON.stringify(root?.container.toJSON() ?? null);

const linkOptions = ["Link with your other device", "Create a phrase on your other device"];

beforeEach(() => {
  deviceActive = false;
  recoveryKey = {};
  deviceStatus = { data: { accountHasActiveDevice: true }, isError: false };
  refetchDeviceStatus.mockClear();
  signOutError = null;
  signOutStatus = "phoneRemoved";
  signOutGate = null;
  alerts.length = 0;
  replace.mockClear();
  signOutOfThisPhone.mockClear();
  clearPendingJoinCodes.mockClear();
  deviceNoun = "phone";
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("a phone that's already set up leaves setup instead of offering it again", async () => {
  deviceActive = true;
  await render();
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("a phone that isn't set up stays on setup", async () => {
  await render();
  expect(replace).not.toHaveBeenCalled();
});

test("stays on setup when the device status can't be checked", async () => {
  deviceActive = new Error("offline");
  await render();
  expect(replace).not.toHaveBeenCalled();
});

test("Cancel asks first, and keeping setup going does nothing", async () => {
  await render();
  await pressCancel();
  expect(alerts.map(({ title }) => title)).toEqual(["Cancel setup?"]);
  await pressAlertButton("Keep setting up");
  expect(signOutOfThisPhone).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});

test.each(["phoneRemoved", "signedOut"] as const)(
  "cancelling removes this phone and leaves setup when sign-out says %s",
  async (status) => {
    signOutStatus = status;
    await render();
    await cancelSetup();
    expect(signOutOfThisPhone.mock.calls.map(([input]) => input)).toMatchObject([
      { removeThisPhone: true, sessionTokenToRevoke: "session-token" },
    ]);
    expect(replace.mock.calls).toEqual([["/"]]);
  },
);

test("cancelling says the phone is only signed out when the server refuses to remove it", async () => {
  await render();
  await cancelSetup();
  expect(alerts.map(({ title }) => title)).toEqual(["Cancel setup?"]);

  signOutStatus = "signedOut";
  await cancelSetup();
  expect(alerts.at(-1)?.title).toBe("You’re signed out");
  expect(alerts.at(-1)?.message).toBe(
    "This phone couldn’t be removed now; it will be removed automatically within 7 days.",
  );
});

test("signing out anyway after an unreachable server doesn't warn again", async () => {
  signOutStatus = "serverUnreachable";
  await render();
  await cancelSetup();
  signOutStatus = "signedOut";
  await pressAlertButton("Sign out anyway");
  expect(alerts.map(({ title }) => title)).toEqual(["Cancel setup?", "Couldn’t reach the server"]);
});

test("when the server can't be reached, stays on setup and offers to try again or sign out anyway", async () => {
  signOutStatus = "serverUnreachable";
  await render();
  await cancelSetup();
  expect(replace).not.toHaveBeenCalled();
  expect(alerts.at(-1)?.title).toBe("Couldn’t reach the server");
  expect(alerts.at(-1)?.message).toContain("removed automatically within 7 days");
  expect(alerts.at(-1)?.buttons.map(({ text }) => text)).toEqual([
    "Back",
    "Sign out anyway",
    "Try again",
  ]);

  await pressAlertButton("Try again");
  expect(signOutOfThisPhone.mock.calls.at(-1)?.[0]).toMatchObject({ removeThisPhone: true });
  expect(replace).not.toHaveBeenCalled();

  signOutStatus = "signedOut";
  await pressAlertButton("Sign out anyway");
  expect(signOutOfThisPhone.mock.calls.at(-1)?.[0]).toMatchObject({ removeThisPhone: false });
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("Back after an unreachable server stays on setup", async () => {
  signOutStatus = "serverUnreachable";
  await render();
  await cancelSetup();
  await pressAlertButton("Back");
  expect(signOutOfThisPhone).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});

test("confirming twice only removes this phone once", async () => {
  let finish = () => {};
  signOutGate = new Promise((resolve) => {
    finish = resolve;
  });
  await render();
  await pressCancel();
  const confirm = alerts.at(-1)?.buttons.find(({ text }) => text === "Cancel and remove");
  await act(async () => {
    confirm?.onPress?.();
    confirm?.onPress?.();
  });
  await act(async () => finish());
  expect(signOutOfThisPhone).toHaveBeenCalledTimes(1);
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("still leaves setup when signing out throws", async () => {
  signOutError = new Error("offline");
  await render();
  await cancelSetup();
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("setup no longer offers a plain sign out", async () => {
  await render();
  expect(shownText()).not.toContain('"Sign out"');
});

test("hides linking when no other phone on the account is active", async () => {
  deviceStatus = { data: { accountHasActiveDevice: false }, isError: false };
  await render();
  expect(shownText()).not.toContain("Link with your other device");
  expect(shownText()).toContain("None of your other devices are signed in");
  expect(shownText()).toContain("Enter your recovery phrase");
  expect(shownText()).toContain("I’ve lost my phrase");
});

test("with no phrase and no other active phone, only offers starting fresh", async () => {
  deviceStatus = { data: { accountHasActiveDevice: false }, isError: false };
  recoveryKey = null;
  await render();
  for (const option of linkOptions) expect(shownText()).not.toContain(option);
  expect(shownText()).not.toContain("Enter your recovery phrase");
  expect(shownText()).toContain("Start fresh");
});

test.each([
  ["another phone is active", { data: { accountHasActiveDevice: true }, isError: false }],
  ["the check is still loading", { isError: false }],
  ["the check failed", { isError: true }],
  ["the server doesn't say", { data: {}, isError: false }],
])("keeps linking on offer when %s", async (_name, status) => {
  deviceStatus = status;
  recoveryKey = null;
  await render();
  for (const option of linkOptions) expect(shownText()).toContain(option);
});

test("checks again for another active phone each time setup is shown", async () => {
  await render();
  expect(refetchDeviceStatus).toHaveBeenCalled();
});

test("a tablet is called a tablet", async () => {
  deviceNoun = "tablet";
  await render();
  expect(shownText()).toContain('"Set up this ","tablet"');
  expect(shownText()).not.toContain('"phone"');
  expect(shownText()).toContain("Cancel and remove this tablet");
});

test("cancelling forgets an invite saved for after setup", async () => {
  await render();
  await cancelSetup();
  expect(clearPendingJoinCodes).toHaveBeenCalledTimes(1);
});

test("an invite isn't forgotten when the server can't be reached to cancel", async () => {
  signOutStatus = "serverUnreachable";
  await render();
  await cancelSetup();
  expect(clearPendingJoinCodes).not.toHaveBeenCalled();
});

test("with a phrase and another active phone, offers linking, the phrase, and losing it", async () => {
  await render();
  expect(shownText()).toContain("Link with your other device");
  expect(shownText()).toContain("Enter your recovery phrase");
  expect(shownText()).toContain("I’ve lost my phrase");
  expect(shownText()).not.toContain("Create a phrase on your other device");
});

test("Continue goes to the first option until another is chosen", async () => {
  await render();
  expect(continueHref()).toBe("/setup/link");
  const reset = findByText("mock-pressable", "I’ve lost my phrase");
  await act(async () => (reset.props as { onPress: () => void }).onPress());
  expect(continueHref()).toEqual({
    pathname: "/account/recovery-reset",
    params: { setup: "true" },
  });
});

test("Continue can't be pressed while cancelling", async () => {
  let finish = () => {};
  signOutGate = new Promise((resolve) => {
    finish = resolve;
  });
  await render();
  expect(findByText("mock-button", "Continue").props["disabled"]).toBe(false);
  await pressCancel();
  const confirm = alerts.at(-1)?.buttons.find(({ text }) => text === "Cancel and remove");
  await act(async () => {
    confirm?.onPress?.();
  });
  expect(findByText("mock-button", "Continue").props["disabled"]).toBe(true);
  await act(async () => finish());
});
