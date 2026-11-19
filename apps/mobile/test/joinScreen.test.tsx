import { beforeEach, expect, mock, test } from "bun:test";
import type { AlertButton } from "react-native";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { InviteToConfirm } from "../lib/inviteTypes.ts";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hosted = "https://api.openbeacon.net";
const selfHosted = "https://beacon.example.com";
const code = "0123456789ABCDEF0123456789ABCDEF";
const alerts: {
  title: string;
  message: string | undefined;
  buttons: AlertButton[];
}[] = [];
const confirming: InviteToConfirm[] = [];
const serverChanges: string[] = [];
const navigation: string[] = [];
const links: unknown[] = [];
const compatibility: { verdict: "ok" | "appTooOld" | "serverTooOld" | null }[] = [];
const pendingChecks: (() => void)[] = [];
const stored = new Map<string, string>();
const savedWhenChanging: (string | undefined)[] = [];
let duringChange = () => {};
let savedServer = "";
let session: { user: { id: string } } | null = { user: { id: "user-1" } };
let params: Record<string, string | string[]> = {};
let holdChecks = false;

mock.module("expo-camera", () => ({
  CameraView: (props: { onBarcodeScanned: (scan: { data: string }) => void }) =>
    React.createElement("camera", props),
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));
mock.module("expo-router", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: unknown }) => {
    links.push(href);
    return children;
  },
  router: {
    canGoBack: () => true,
    back: () => navigation.push("back"),
    replace: (href: string) => navigation.push(`replace ${href}`),
    push: (href: string) => navigation.push(`push ${href}`),
  },
  useLocalSearchParams: () => params,
}));
mock.module("react-native", () => {
  const module = createReactNativeTestModule();
  return { ...module, ScrollView: module.View, TextInput: () => null };
});
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (title: string, message?: string, buttons: AlertButton[] = []) =>
      alerts.push({ title, message, buttons }),
  },
}));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getString: (key: string) => (key === "custom_server_url" ? savedServer : stored.get(key)),
    getAllKeys: () => [...stored.keys()],
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));
mock.module("../lib/changeServer.ts", () => ({
  changeServer: async (url: string) => {
    savedWhenChanging.push(stored.get("inviteForSignIn"));
    duringChange();
    serverChanges.push(url);
    savedServer = url;
    session = null;
  },
}));
mock.module("../lib/apiCompatibility.ts", () => ({
  checkServerCompatibility: async () => {
    if (holdChecks) await new Promise<void>((resolve) => pendingChecks.push(resolve));
    return {
      ...(compatibility.shift() ?? { verdict: "ok" }),
      serverVersion: "0.1.0",
    };
  },
}));
mock.module("../lib/api.ts", () => ({
  trpc: { accountRecovery: { status: { queryOptions: () => ({}) } } },
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { recoveryKey: "set" } }),
}));
mock.module("../lib/endSession.ts", () => ({ readLostSessions: () => [] }));
mock.module("../lib/thisDeviceNoun.ts", () => ({
  thisDeviceNoun: () => "phone",
}));
mock.module("../lib/registeredDevice.ts", () => ({
  readRegisteredDeviceNow: () => null,
}));
mock.module("../lib/deviceActivation.ts", () => ({
  readThisDeviceState: () => "active",
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));
mock.module("../components/InviteConfirmation.tsx", () => ({
  InviteConfirmation: ({ invite }: { invite: InviteToConfirm }) => {
    confirming.push(invite);
    return null;
  },
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({
    children,
    loading,
    onPress,
  }: {
    children: React.ReactNode;
    loading?: boolean;
    onPress?: () => void;
  }) => React.createElement("pressable", { loading, onPress }, children),
}));
mock.module("../components/headers/ScreenHeader.tsx", () => ({
  ScreenHeader: () => null,
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("lucide-react-native", () => ({ QrCodeIcon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));

const { default: Join } = await import("../app/join.tsx");

const screenText = (root: ReturnType<typeof createRoot>) => JSON.stringify(root.container.toJSON());

const findButton = (root: ReturnType<typeof createRoot>, label: string) => {
  const button = root.container
    .queryAll((node) => node.type === "pressable")
    .find((node) => JSON.stringify(node.toJSON()).includes(label));
  if (!button) throw new Error(`No ${label} button`);
  return button;
};

const pressButton = async (root: ReturnType<typeof createRoot>, label: string) => {
  const button = findButton(root, label);
  await act(async () => button.props["onPress"]());
};

const pressAlertButton = async (label: string) => {
  const button = alerts.at(-1)?.buttons.find(({ text }) => text === label);
  if (!button?.onPress) throw new Error(`No ${label} in the alert`);
  await act(async () => button.onPress?.());
};

const openJoin = async () => {
  const root = createRoot();
  await act(async () => root.render(<Join />));
  return root;
};

const openScanner = async () => {
  const root = await openJoin();
  await pressButton(root, "Scan QR code");
  const camera = root.container.queryAll((node) => node.type === "camera")[0];
  const onBarcodeScanned = camera?.props["onBarcodeScanned"];
  if (typeof onBarcodeScanned !== "function") throw new Error("Scanner didn't open");
  return { root, scanned: (data: string) => onBarcodeScanned({ data }) };
};

const openInviteFrom = (server: string) => {
  params = { code, server };
  return openJoin();
};

beforeEach(() => {
  alerts.length = 0;
  confirming.length = 0;
  serverChanges.length = 0;
  navigation.length = 0;
  links.length = 0;
  compatibility.length = 0;
  pendingChecks.length = 0;
  holdChecks = false;
  stored.clear();
  savedWhenChanging.length = 0;
  duringChange = () => {};
  savedServer = "";
  session = { user: { id: "user-1" } };
  params = {};
});

test("a QR code that isn't an invite is reported once, however many frames see it", async () => {
  const { scanned } = await openScanner();
  await act(async () => {
    scanned("https://example.test/");
    scanned("https://example.test/");
    scanned("https://example.test/");
  });
  expect(alerts.map(({ title, message }) => [title, message])).toEqual([
    ["Invalid code", "That QR code isn’t an OpenBeacon invite."],
  ]);
  expect(confirming).toEqual([]);
});

test("a scanned invite link opens the confirmation for its code", async () => {
  const { scanned } = await openScanner();
  await act(async () => {
    scanned(`openbeacon://join?code=${code.toLowerCase()}`);
    scanned("https://example.test/");
  });
  expect(alerts).toEqual([]);
  expect(confirming.at(-1)).toEqual({ kind: "code", code });
});

test("a scanned invite whose server can't be used says so instead of joining", async () => {
  const { scanned } = await openScanner();
  await act(async () =>
    scanned(`openbeacon://join?code=${code}&server=${encodeURIComponent("https://аpi.test")}`),
  );
  expect(alerts.map(({ title, message }) => [title, message])).toEqual([
    ["Invalid code", "That QR code’s server address can’t be used. Ask for a new invite."],
  ]);
  expect(confirming).toEqual([]);
});

test("a signed-in user who changes server ends up signed out, ready to sign in there with the invite", async () => {
  const root = await openInviteFrom(selfHosted);
  const shown = screenText(root);
  expect(shown).toContain("This invite is for another server");
  expect(shown).toContain("beacon.example.com");
  expect(shown).toContain("You’re using OpenBeacon’s hosted server.");
  expect(shown).toContain("Changing server signs you out on this phone");
  expect(confirming).toEqual([]);

  await pressButton(root, "Change server");
  expect(alerts.map(({ title }) => title)).toEqual(["Change server?"]);
  expect(findButton(root, "Change server").props["loading"]).toBe(true);
  await pressAlertButton("Change server");

  expect(serverChanges).toEqual([selfHosted]);
  const signedOut = screenText(root);
  expect(signedOut).toContain(
    "Sign in or create an account on beacon.example.com to join this group. An account on another server won’t work here.",
  );
  expect(links).toContainEqual({
    pathname: "/signIn",
    params: { joinCode: code },
  });
  expect(links).toContainEqual({
    pathname: "/signUp",
    params: { joinCode: code },
  });
  expect(confirming).toEqual([]);
});

test("a signed-out user changes server without a key warning", async () => {
  session = null;
  const root = await openInviteFrom(`${selfHosted}/openbeacon`);
  const shown = screenText(root);
  expect(shown).toContain(`${selfHosted}/openbeacon`);
  expect(shown).not.toContain("Changing server signs you out");

  await pressButton(root, "Change server");

  expect(alerts).toEqual([]);
  expect(serverChanges).toEqual([`${selfHosted}/openbeacon`]);
  expect(screenText(root)).toContain("Sign in or create an account on beacon.example.com");
});

test("an invite for the hosted server switches a self-hosted phone back to the default", async () => {
  savedServer = selfHosted;
  session = null;
  const root = await openInviteFrom(hosted);
  expect(screenText(root)).toContain("OpenBeacon’s hosted server");

  await pressButton(root, "Change server");

  expect(serverChanges).toEqual([""]);
  expect(screenText(root)).toContain("Sign in to join this group.");
});

test("a look-alike name gets a warning that it isn't the hosted server", async () => {
  const root = await openInviteFrom("https://openbeacon-login.example");
  expect(screenText(root)).toContain("This isn’t OpenBeacon’s hosted server.");
});

test("Don’t change leaves the screen and keeps the server", async () => {
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Don’t change");

  expect(navigation).toEqual(["back"]);
  expect(serverChanges).toEqual([]);
});

test("an invite from the server this phone already uses goes straight to the confirmation", async () => {
  savedServer = selfHosted;
  await openInviteFrom(selfHosted);

  expect(serverChanges).toEqual([]);
  expect(confirming.at(-1)).toEqual({ kind: "code", code });
});

test("an opened invite whose server can't be used explains why and offers to go back", async () => {
  Object.assign(globalThis, { __DEV__: false });
  try {
    const root = await openInviteFrom("http://beacon.example.com");
    expect(screenText(root)).toContain("This invite can’t be used");
    expect(screenText(root)).toContain(
      "It points to a server address the app can’t use. Ask for a new invite.",
    );
    expect(confirming).toEqual([]);

    await pressButton(root, "Go back");

    expect(navigation).toEqual(["back"]);
  } finally {
    Object.assign(globalThis, { __DEV__: true });
  }
});

test("repeated link parameters are treated as no invite instead of crashing", async () => {
  params = { code: [code, code], server: selfHosted };
  const root = await openJoin();
  expect(screenText(root)).toContain("Scan QR code");
  params = { code, server: [selfHosted, "https://evil.example"] };
  const second = await openJoin();
  expect(screenText(second)).toContain("Scan QR code");
  expect(confirming).toEqual([]);
});

test("a second tap while a change is under way does nothing", async () => {
  session = null;
  holdChecks = true;
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Change server");
  await pressButton(root, "Change server");
  expect(pendingChecks).toHaveLength(1);
  expect(findButton(root, "Change server").props["loading"]).toBe(true);

  await act(async () => pendingChecks[0]?.());

  expect(serverChanges).toEqual([selfHosted]);
});

test("cancelling the warning clears the busy state", async () => {
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Change server");
  await pressAlertButton("Cancel");

  expect(findButton(root, "Change server").props["loading"]).toBe(false);
  expect(serverChanges).toEqual([]);
});

test("an unreachable server offers to try again and never changes server", async () => {
  session = null;
  compatibility.push({ verdict: null }, { verdict: null });
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Change server");
  expect(alerts.at(-1)?.title).toBe("Couldn’t reach this server");
  expect(alerts.at(-1)?.buttons.map(({ text }) => text)).toEqual(["Cancel", "Try again"]);
  await pressAlertButton("Try again");
  expect(alerts).toHaveLength(2);
  await pressAlertButton("Cancel");

  expect(serverChanges).toEqual([]);
  expect(findButton(root, "Change server").props["loading"]).toBe(false);
});

test("a check that finishes after the user left is ignored", async () => {
  session = null;
  holdChecks = true;
  compatibility.push({ verdict: null });
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Change server");
  await act(async () => root.unmount());
  await act(async () => pendingChecks[0]?.());

  expect(alerts).toEqual([]);
  expect(serverChanges).toEqual([]);
});

const savedInviteCode = () => {
  const saved = stored.get("inviteForSignIn");
  return saved ? (JSON.parse(saved) as { code: string }).code : null;
};

test("the invite is saved before the change and forgotten when the screen stays open", async () => {
  session = null;
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Change server");

  expect(savedWhenChanging.map((saved) => saved && JSON.parse(saved).code)).toEqual([code]);
  expect(savedInviteCode()).toBeNull();
});

test("the invite is kept for sign-in when the change closes the screen", async () => {
  const root = await openInviteFrom(selfHosted);
  duringChange = () => root.unmount();

  await pressButton(root, "Change server");
  await pressAlertButton("Change server");

  expect(serverChanges).toEqual([selfHosted]);
  expect(savedInviteCode()).toBe(code);
});

test("a change that fails forgets the invite and clears the busy state", async () => {
  session = null;
  const root = await openInviteFrom(selfHosted);
  duringChange = () => {
    throw new Error("change failed");
  };

  await pressButton(root, "Change server");

  expect(savedWhenChanging).toHaveLength(1);
  expect(savedInviteCode()).toBeNull();
  expect(findButton(root, "Change server").props["loading"]).toBe(false);
});

test("a cancelled change never saves the invite", async () => {
  const root = await openInviteFrom(selfHosted);

  await pressButton(root, "Change server");
  await pressAlertButton("Cancel");

  expect(savedWhenChanging).toEqual([]);
  expect(stored.has("inviteForSignIn")).toBe(false);
});

test("only an invite for a server other than the hosted one warns about who runs it", async () => {
  const warning = "Only change server if someone you know runs it";
  expect(screenText(await openInviteFrom(selfHosted))).toContain(warning);
  savedServer = selfHosted;
  expect(screenText(await openInviteFrom(hosted))).not.toContain(warning);
});
