import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const shown: string[] = [];
const shownEvents: { kind: string; title: string }[] = [];
let showFails = false;
const appState = {
  currentState: "background",
  addEventListener: () => ({ remove: () => {} }),
};

const platform = { OS: "android", Version: 34 };
const android = {
  granted: false,
  rationale: false,
  result: "granted",
  notificationsEnabled: true,
  requests: 0,
};

mock.module("react-native", () => ({
  ...createReactNativeTestModule({ appState, platformOS: "android" }),
  Platform: platform,
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS" },
    RESULTS: { DENIED: "denied", GRANTED: "granted", NEVER_ASK_AGAIN: "never_ask_again" },
    check: async () => android.granted,
    request: async () => {
      android.requests += 1;
      return android.result;
    },
  },
}));

const settings = { opened: [] as string[], sendIntentFails: false };
const inApp: { title: string; body: string | null }[] = [];

mock.module("./inAppNotices.ts", () => ({
  showInAppNotice: ({ title, body }: { title: string; body: string | null }) => {
    inApp.push({ title, body });
  },
}));

mock.module("expo-linking", () => ({
  openSettings: async () => {
    settings.opened.push("app details");
  },
  sendIntent: async (action: string, extras: { key: string; value: string }[]) => {
    if (settings.sendIntentFails) throw new Error("No activity found");
    settings.opened.push(`${action} ${extras.map((extra) => extra.value).join(" ")}`);
  },
}));

mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    showNotice: (kind: string) => {
      if (showFails) throw new Error("Unknown notice");
      shown.push(kind);
      return true;
    },
    showEventNotice: (kind: string, _key: string, title: string) => {
      shownEvents.push({ kind, title });
      return true;
    },
    areNotificationsEnabled: () => android.notificationsEnabled,
    shouldShowNotificationRationale: () => android.rationale,
  },
}));

const { requestNotificationPermissions, showEventNotice, showNotice, turnOnNotifications } =
  await import("./notifications.ts");

beforeEach(() => {
  shown.length = 0;
  shownEvents.length = 0;
  inApp.length = 0;
  settings.opened.length = 0;
  settings.sendIntentFails = false;
  showFails = false;
  appState.currentState = "background";
  platform.Version = 34;
  Object.assign(android, {
    granted: false,
    rationale: false,
    result: "granted",
    notificationsEnabled: true,
    requests: 0,
  });
});

describe("showEventNotice", () => {
  test("an in-app banner without a body names the group instead", async () => {
    appState.currentState = "active";
    inApp.length = 0;
    await showEventNotice({
      body: null,
      groupName: "Family",
      key: "event-1",
      kind: "groupActivity",
      link: { href: "/", url: "openbeacon:///" },
      title: "Mum joined",
    });
    expect(inApp).toEqual([{ title: "Mum joined", body: "Family" }]);
    expect(shownEvents).toEqual([]);
  });

  test("a security alert while the app is open also goes to the notification shade", async () => {
    appState.currentState = "active";
    const shown = await showEventNotice({
      body: "Every phone and tablet was signed out.",
      groupName: null,
      key: "notice-1",
      kind: "accountAlert",
      link: { href: "/account/password", url: "openbeacon:///account/password" },
      title: "Your password was reset",
    });
    expect(shown).toBe(true);
    expect(inApp).toEqual([
      { title: "Your password was reset", body: "Every phone and tablet was signed out." },
    ]);
    expect(shownEvents).toEqual([{ kind: "accountAlert", title: "Your password was reset" }]);
  });
});

describe("showNotice", () => {
  test("only tells self-hosters their own server needs updating", async () => {
    await showNotice({ kind: "compatibility", problem: "serverTooOld", selfHosted: true });
    await showNotice({ kind: "compatibility", problem: "serverTooOld", selfHosted: false });
    await showNotice({ kind: "compatibility", problem: "appTooOld", selfHosted: true });
    expect(shown).toEqual(["selfHostedServerTooOld", "serverTooOld", "appTooOld"]);
  });

  test("reports the notice as not shown when Android refuses it", async () => {
    showFails = true;
    expect(await showNotice({ kind: "signedOut" })).toBe(false);
  });

  test("leaves the notice to the in-app screens while the app is open", async () => {
    appState.currentState = "active";
    expect(
      await showNotice({ kind: "compatibility", problem: "appTooOld", selfHosted: false }),
    ).toBe(false);
    expect(await showNotice({ kind: "signedOut" })).toBe(false);
    expect(shown).toEqual([]);
  });
});

describe("requestNotificationPermissions", () => {
  test("is granted when the person allows notifications the first time", async () => {
    expect(await requestNotificationPermissions()).toBe("granted");
    expect(android.requests).toBe(1);
  });

  test("is denied when the person taps Don’t allow", async () => {
    android.result = "denied";
    expect(await requestNotificationPermissions()).toBe("denied");
  });

  test("is denied, not blocked, when the second Don’t allow stops Android asking again", async () => {
    android.rationale = true;
    android.result = "never_ask_again";
    expect(await requestNotificationPermissions()).toBe("denied");
  });

  test("is blocked when Android no longer shows the dialog", async () => {
    android.result = "never_ask_again";
    expect(await requestNotificationPermissions()).toBe("blocked");
  });

  test("is blocked when the permission is granted but notifications are turned off", async () => {
    android.granted = true;
    android.notificationsEnabled = false;
    expect(await requestNotificationPermissions()).toBe("blocked");
    expect(android.requests).toBe(0);
  });

  test("does not ask before Android 13, where no permission is needed", async () => {
    platform.Version = 32;
    expect(await requestNotificationPermissions()).toBe("granted");
    expect(android.requests).toBe(0);
  });
});

describe("turnOnNotifications", () => {
  test("opens OpenBeacon’s notification settings when Android won’t ask", async () => {
    android.result = "never_ask_again";
    await turnOnNotifications();
    expect(settings.opened).toEqual([
      "android.settings.APP_NOTIFICATION_SETTINGS net.openbeacon.app",
    ]);
  });

  test("falls back to the app’s details page when the notification settings can’t open", async () => {
    android.granted = true;
    android.notificationsEnabled = false;
    settings.sendIntentFails = true;
    await turnOnNotifications();
    expect(settings.opened).toEqual(["app details"]);
  });

  test("stays in the app when the person allows or denies in the dialog", async () => {
    await turnOnNotifications();
    android.result = "denied";
    await turnOnNotifications();
    expect(settings.opened).toEqual([]);
  });
});
