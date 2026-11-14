import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const shown: string[] = [];
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

mock.module("expo-linking", () => ({ openSettings: async () => {}, sendIntent: async () => {} }));

mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    showNotice: (kind: string) => {
      if (showFails) throw new Error("Unknown notice");
      shown.push(kind);
      return true;
    },
    areNotificationsEnabled: () => android.notificationsEnabled,
    shouldShowNotificationRationale: () => android.rationale,
  },
}));

const { requestNotificationPermissions, showNotice } = await import("./notifications.ts");

beforeEach(() => {
  shown.length = 0;
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
