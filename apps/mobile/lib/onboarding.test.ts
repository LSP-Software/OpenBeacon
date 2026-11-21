import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { OnboardingProgress } from "./onboardingTypes.ts";

const storageValues = new Map<string, string>();
const events: unknown[] = [];
let registeredUserId: string | null = "user-1";
let notificationsEnabled: boolean | Error = false;
let locationMissing: string[] | Error = ["foreground"];
let recoveryKey: string | null | Error = null;
let appLockEnabled = false;
let statusChecks = 0;

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./registeredDevice.ts", () => ({
  readRegisteredDeviceNow: () =>
    registeredUserId ? { deviceId: "device-1", publicKey: "key", userId: registeredUserId } : null,
}));
mock.module("expo-router", () => ({
  router: { replace: (target: unknown) => events.push(target) },
}));
mock.module("./pendingJoinCode.ts", () => ({
  openAppAfterSetup: (home: string) => events.push(`openApp:${home}`),
}));
mock.module("./notifications.ts", () => ({
  areNotificationsEnabled: async () => {
    statusChecks += 1;
    if (notificationsEnabled instanceof Error) throw notificationsEnabled;
    return notificationsEnabled;
  },
}));
mock.module("./locationPermissions.ts", () => ({
  getLocationPermissionState: async () => {
    if (locationMissing instanceof Error) throw locationMissing;
    return { missing: locationMissing };
  },
}));
mock.module("./api.ts", () => ({
  trpcClient: {
    accountRecovery: {
      status: {
        query: async () => {
          if (recoveryKey instanceof Error) throw recoveryKey;
          return { recoveryKey };
        },
      },
    },
  },
}));
mock.module("./appLock.ts", () => ({
  getAppLockState: () => ({ enabled: appLockEnabled }),
}));

const {
  advanceOnboarding,
  continueOnboarding,
  planCurrentOnboarding,
  readOnboarding,
  startOnboarding,
} = await import("./onboarding.ts");

const store = (progress: OnboardingProgress) =>
  storageValues.set("onboarding.user-1", JSON.stringify(progress));

beforeEach(() => {
  storageValues.clear();
  events.length = 0;
  registeredUserId = "user-1";
  notificationsEnabled = false;
  locationMissing = ["foreground"];
  recoveryKey = null;
  appLockEnabled = false;
  statusChecks = 0;
});

describe("advancing onboarding", () => {
  test("goes to the next step's screen and remembers what is done", () => {
    store({ kind: "newAccount", steps: ["name", "notifications", "location"], done: [] });

    advanceOnboarding("name");

    expect(events).toEqual(["/onboarding/notifications"]);
    expect(readOnboarding("user-1")?.done).toEqual(["name"]);
  });

  test("completing several steps at once skips past all of them", () => {
    store({
      kind: "returning",
      steps: ["location", "background", "appLock"],
      done: [],
    });

    advanceOnboarding(["location", "background"]);

    expect(events).toEqual(["/onboarding/app-lock"]);
  });

  test("going back and continuing revisits the step in between", () => {
    store({
      kind: "newAccount",
      steps: ["name", "notifications", "location"],
      done: ["name", "notifications"],
    });

    advanceOnboarding("name");

    expect(events).toEqual(["/onboarding/notifications"]);
  });

  test("a new phone shows the done screen after the last step", () => {
    store({ kind: "newDevice", steps: ["restore", "name"], done: ["restore"] });

    advanceOnboarding("name");

    expect(events).toEqual(["/onboarding/done"]);
    expect(storageValues.has("onboarding.user-1")).toBe(true);
  });

  test("signing in again finishes straight away after the last step", () => {
    store({ kind: "returning", steps: ["notifications"], done: [] });

    advanceOnboarding("notifications");

    expect(events).toEqual(["openApp:/(tabs)/map"]);
    expect(storageValues.has("onboarding.user-1")).toBe(false);
  });

  test("opens the app when there is no planned onboarding", () => {
    advanceOnboarding("name");
    startOnboarding("user-1", "newAccount");
    advanceOnboarding("name");
    store({ kind: "newAccount", steps: ["name"], done: [] });
    registeredUserId = null;
    advanceOnboarding("name");

    expect(events).toEqual(["openApp:/", "openApp:/", "openApp:/"]);
  });

  test("ignores stored progress it can't read", () => {
    storageValues.set("onboarding.user-1", "{not json");
    advanceOnboarding("name");
    storageValues.set("onboarding.user-1", JSON.stringify({ kind: "someone", done: [] }));
    advanceOnboarding("name");

    expect(events).toEqual(["openApp:/", "openApp:/"]);
  });

  test("resumes progress saved with a step that no longer exists", () => {
    storageValues.set(
      "onboarding.user-1",
      JSON.stringify({
        kind: "newAccount",
        steps: ["name", "notifications", "sharing", "location", "background"],
        done: ["name", "notifications", "sharing"],
      }),
    );

    const progress = readOnboarding("user-1");
    if (progress) continueOnboarding(progress);

    expect(progress).toEqual({
      kind: "newAccount",
      steps: ["name", "notifications", "location", "background"],
      done: ["name", "notifications"],
    });
    expect(events).toEqual(["/onboarding/location"]);
  });
});

describe("planning onboarding", () => {
  test("plans from what this phone still needs, only once", async () => {
    startOnboarding("user-1", "newAccount");

    const planned = await planCurrentOnboarding();
    notificationsEnabled = true;
    const again = await planCurrentOnboarding();

    expect(planned?.steps).toEqual([
      "name",
      "notifications",
      "location",
      "background",
      "recovery",
      "appLock",
    ]);
    expect(again).toEqual(planned);
    expect(readOnboarding("user-1")).toEqual(planned);
    expect(statusChecks).toBe(1);
  });

  test("leaves out what is already set up", async () => {
    startOnboarding("user-1", "returning");
    notificationsEnabled = true;
    locationMissing = [];
    recoveryKey = "phrase";
    appLockEnabled = true;

    expect((await planCurrentOnboarding())?.steps).toEqual([]);
  });

  test("asks for everything it couldn't check", async () => {
    startOnboarding("user-1", "newAccount");
    notificationsEnabled = new Error("offline");
    locationMissing = new Error("unavailable");
    recoveryKey = new Error("offline");

    expect((await planCurrentOnboarding())?.steps).toEqual([
      "name",
      "notifications",
      "location",
      "background",
      "recovery",
      "appLock",
    ]);
  });

  test("has nothing to plan without onboarding or a registered device", async () => {
    expect(await planCurrentOnboarding()).toBeNull();

    startOnboarding("user-1", "newAccount");
    registeredUserId = null;
    expect(await planCurrentOnboarding()).toBeNull();
    expect(statusChecks).toBe(0);
  });
});
