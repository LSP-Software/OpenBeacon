import { afterEach, beforeEach, expect, jest, mock, setSystemTime, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";
import type { RelockAfter } from "./appLockTypes.ts";

type PromptResult = { success: true } | { success: false; error: string };

const stored = new Map<string, boolean | number>([["appLock.enabled", true]]);
const appStateListeners = new Set<(state: string) => void>();
const appState = {
  currentState: "active",
  addEventListener: (_event: string, listener: (state: string) => void) => {
    const subscription = (state: string) => listener(state);
    appStateListeners.add(subscription);
    return { remove: () => appStateListeners.delete(subscription) };
  },
};
const phone = {
  level: 1,
  elapsedRealtime: 1_000_000,
  prompts: 0,
  cancels: 0,
  keyboardDismissals: 0,
  results: [] as PromptResult[],
  duringPrompt: (): void => {},
  pending: null as ((result: PromptResult) => void) | null,
  hang: false,
};
const recentsHidden: boolean[] = [];
const platform = { OS: "android", Version: 33 };

const changeTo = (state: string) => {
  appState.currentState = state;
  for (const listener of appStateListeners) listener(state);
};

mock.module("react-native", () => ({
  ...createReactNativeTestModule({ appState }),
  Platform: platform,
  Keyboard: {
    dismiss: () => {
      phone.keyboardDismissals += 1;
    },
  },
}));
mock.module("./storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => stored.get(key),
    getNumber: (key: string) => stored.get(key),
    set: (key: string, value: boolean | number) => stored.set(key, value),
  },
}));
mock.module("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1 },
  getEnrolledLevelAsync: async () => phone.level,
  authenticateAsync: async () => {
    phone.prompts += 1;
    if (phone.hang) {
      return new Promise<PromptResult>((resolve) => {
        phone.pending = resolve;
      });
    }
    phone.duringPrompt();
    return phone.results.shift() ?? { success: true };
  },
  cancelAuthenticate: async () => {
    phone.cancels += 1;
    phone.pending?.({ success: false, error: "user_cancel" });
    phone.pending = null;
  },
}));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    elapsedRealtime: () => phone.elapsedRealtime,
    setRecentsPreviewHidden: async (hidden: boolean) => {
      recentsHidden.push(hidden);
    },
  },
}));

const appLock = await import("./appLock.ts");
appLock.startAppLock();
const coldStart = { ...appLock.getAppLockState(), recentsHidden: [...recentsHidden] };

const passTime = (ms: number) => {
  phone.elapsedRealtime += ms;
};

const leaveFor = (ms: number) => {
  changeTo("background");
  passTime(ms);
  changeTo("active");
};

const turnOn = async (relockAfter: RelockAfter) => {
  expect(await appLock.turnOnAppLock()).toBe("confirmed");
  expect(await appLock.changeRelockAfter(relockAfter)).toBe("confirmed");
};

beforeEach(async () => {
  appState.currentState = "active";
  phone.level = 1;
  phone.results = [];
  phone.duringPrompt = () => {};
  phone.hang = false;
  phone.pending = null;
  platform.Version = 33;
  await appLock.turnOffAppLock();
  changeTo("background");
  changeTo("active");
  phone.prompts = 0;
  phone.cancels = 0;
  phone.keyboardDismissals = 0;
  recentsHidden.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

test("a cold start with app lock on starts locked and hides the recent apps preview", () => {
  expect(coldStart).toMatchObject({ enabled: true, locked: true, recentsHidden: [true] });
});

test("each new app window locks again when app lock is on, since the process can outlive it", async () => {
  await turnOn(300_000);

  appLock.startAppLock();

  expect(appLock.getAppLockState().locked).toBe(true);
  expect(recentsHidden).toEqual([true, true]);
});

test("a new app window clears a leftover away cover and asks to unlock once", async () => {
  await turnOn(300_000);
  changeTo("background");
  expect(appLock.getAppLockState().away).toBe(true);
  const { promptRequest } = appLock.getAppLockState();

  appLock.startAppLock();

  expect(appLock.getAppLockState()).toMatchObject({
    locked: true,
    away: false,
    promptRequest: promptRequest + 1,
  });
  changeTo("active");
});

test("starting with app lock off doesn't lock", () => {
  appLock.startAppLock();

  expect(appLock.getAppLockState().locked).toBe(false);
  expect(recentsHidden).toEqual([false]);
});

test("unlocking needs the phone's screen lock, and a failed try stays locked", async () => {
  await turnOn(0);
  leaveFor(1_000);
  expect(appLock.getAppLockState().locked).toBe(true);

  phone.results = [{ success: false, error: "user_cancel" }];
  expect(await appLock.unlockApp()).toBe("failed");
  expect(appLock.getAppLockState().locked).toBe(true);

  phone.results = [{ success: false, error: "lockout" }];
  expect(await appLock.unlockApp()).toBe("lockedOut");
  expect(appLock.getAppLockState().locked).toBe(true);

  expect(await appLock.unlockApp()).toBe("confirmed");
  expect(appLock.getAppLockState().locked).toBe(false);
});

test("'Immediately' locks as the app leaves the screen, dismissing the keyboard, and prompts once on return", async () => {
  await turnOn(0);
  const { promptRequest } = appLock.getAppLockState();

  changeTo("background");
  expect(appLock.getAppLockState()).toMatchObject({ locked: true, away: false, promptRequest });
  expect(phone.keyboardDismissals).toBe(1);

  changeTo("active");
  expect(appLock.getAppLockState().promptRequest).toBe(promptRequest + 1);
});

test("with a delay, leaving only hides the app, and a short trip away doesn't lock it", async () => {
  await turnOn(60_000);

  changeTo("background");
  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: true });

  passTime(59_000);
  changeTo("active");
  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: false });
  expect(phone.keyboardDismissals).toBe(0);
});

test("it locks again after the chosen time away", async () => {
  await turnOn(300_000);
  const { promptRequest } = appLock.getAppLockState();

  leaveFor(300_000);

  expect(appLock.getAppLockState()).toMatchObject({
    locked: true,
    away: false,
    promptRequest: promptRequest + 1,
  });
  expect(phone.keyboardDismissals).toBe(1);
});

test("time away is measured on the phone's uptime clock, so changing the date doesn't matter", async () => {
  await turnOn(60_000);

  changeTo("background");
  passTime(120_000);
  setSystemTime(new Date("2020-01-01T00:00:00Z"));
  changeTo("active");
  setSystemTime();

  expect(appLock.getAppLockState().locked).toBe(true);
});

test("leaving the app while the lock is off never locks or hides it", () => {
  leaveFor(3_600_000);

  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: false });
});

test("a locked app coming back asks to unlock exactly once", async () => {
  await turnOn(60_000);
  leaveFor(60_000);
  const { promptRequest } = appLock.getAppLockState();

  leaveFor(1_000);

  expect(appLock.getAppLockState().promptRequest).toBe(promptRequest + 1);
});

test("the screen lock prompt sending the app to the background doesn't lock it again", async () => {
  await turnOn(0);
  leaveFor(0);
  phone.duringPrompt = () => {
    changeTo("background");
    changeTo("active");
  };

  expect(await appLock.unlockApp()).toBe("confirmed");

  expect(appLock.getAppLockState().locked).toBe(false);
});

test("below Android 11, cancelling the PIN screen, which backgrounds the app, doesn't ask again on return", async () => {
  platform.Version = 29;
  await turnOn(0);
  leaveFor(0);
  const { promptRequest } = appLock.getAppLockState();
  phone.duringPrompt = () => changeTo("background");
  phone.results = [{ success: false, error: "user_cancel" }];

  expect(await appLock.unlockApp()).toBe("failed");
  changeTo("active");
  expect(appLock.getAppLockState()).toMatchObject({ locked: true, promptRequest });

  expect(await appLock.unlockApp()).toBe("confirmed");
  changeTo("active");
  expect(appLock.getAppLockState()).toMatchObject({ locked: false, promptRequest });
});

test("from Android 11, leaving while the unlock prompt is open asks again on return", async () => {
  platform.Version = 30;
  await turnOn(0);
  leaveFor(0);
  const { promptRequest } = appLock.getAppLockState();
  phone.duringPrompt = () => changeTo("background");
  phone.results = [{ success: false, error: "system_cancel" }];

  expect(await appLock.unlockApp()).toBe("failed");
  expect(appLock.getAppLockState()).toMatchObject({ locked: true, away: true, promptRequest });

  passTime(60_000);
  changeTo("active");
  expect(appLock.getAppLockState()).toMatchObject({
    locked: true,
    away: false,
    promptRequest: promptRequest + 1,
  });
});

test("cancelling 'Confirm it's you' on an 'Immediately' lock doesn't lock the app", async () => {
  await turnOn(0);
  phone.duringPrompt = () => changeTo("background");
  phone.results = [{ success: false, error: "user_cancel" }];

  expect(await appLock.confirmWithPhoneLock("Confirm it’s you")).toBe("failed");
  changeTo("active");

  expect(appLock.getAppLockState().locked).toBe(false);
});

test("below Android 11, a cancelled prompt doesn't ask again by itself, but coming back to a locked app does", async () => {
  platform.Version = 29;
  await turnOn(0);
  leaveFor(0);
  const { promptRequest } = appLock.getAppLockState();
  phone.duringPrompt = () => {
    changeTo("background");
    changeTo("active");
  };
  phone.results = [{ success: false, error: "user_cancel" }];

  await appLock.unlockApp();
  expect(appLock.getAppLockState().promptRequest).toBe(promptRequest);

  phone.duringPrompt = () => {};
  leaveFor(1_000);
  expect(appLock.getAppLockState().promptRequest).toBe(promptRequest + 1);
});

test("leaving mid-prompt from 'Confirm it's you' still counts as time away", async () => {
  await turnOn(60_000);
  phone.duringPrompt = () => changeTo("background");
  phone.results = [{ success: false, error: "system_cancel" }];

  expect(await appLock.confirmWithPhoneLock("Confirm it’s you")).toBe("failed");
  passTime(120_000);
  changeTo("active");

  expect(appLock.getAppLockState().locked).toBe(true);
});

test("it won't prompt while the app isn't on screen or another prompt is open", async () => {
  appState.currentState = "background";
  expect(await appLock.confirmWithPhoneLock("Confirm it’s you")).toBe("failed");
  expect(phone.prompts).toBe(0);

  appState.currentState = "active";
  phone.hang = true;
  const first = appLock.confirmWithPhoneLock("Confirm it’s you");
  expect(await appLock.confirmWithPhoneLock("Confirm it’s you")).toBe("failed");
  expect(phone.prompts).toBe(1);

  phone.pending?.({ success: true });
  expect(await first).toBe("confirmed");
});

test("a prompt still open a second after coming back is cancelled so the lock doesn't get stuck", async () => {
  jest.useFakeTimers();
  await turnOn(60_000);
  phone.hang = true;
  const prompt = appLock.confirmWithPhoneLock("Confirm it’s you");
  changeTo("background");
  passTime(120_000);
  changeTo("active");

  jest.advanceTimersByTime(999);
  expect(phone.cancels).toBe(0);
  jest.advanceTimersByTime(1);
  expect(phone.cancels).toBe(1);

  expect(await prompt).toBe("failed");
  expect(appLock.getAppLockState().locked).toBe(true);
});

test("a late cancel timer leaves a newer prompt alone", async () => {
  jest.useFakeTimers();
  await turnOn(60_000);
  phone.hang = true;
  const stale = appLock.confirmWithPhoneLock("Confirm it’s you");
  changeTo("background");
  changeTo("active");
  phone.pending?.({ success: true });
  await stale;

  const fresh = appLock.confirmWithPhoneLock("Confirm it’s you");
  jest.advanceTimersByTime(1_000);
  expect(phone.cancels).toBe(0);

  phone.pending?.({ success: true });
  expect(await fresh).toBe("confirmed");
});

test("app lock can't be turned on without a phone screen lock", async () => {
  phone.level = 0;

  expect(await appLock.turnOnAppLock()).toBe("noScreenLock");

  expect(appLock.getAppLockState().enabled).toBe(false);
  expect(phone.prompts).toBe(0);
});

test("turning app lock on or off needs the phone's screen lock", async () => {
  phone.results = [{ success: false, error: "user_cancel" }];
  expect(await appLock.turnOnAppLock()).toBe("failed");
  expect(appLock.getAppLockState().enabled).toBe(false);

  await turnOn(0);
  expect(appLock.getAppLockState().enabled).toBe(true);
  expect(stored.get("appLock.enabled")).toBe(true);

  phone.results = [{ success: false, error: "user_cancel" }];
  expect(await appLock.turnOffAppLock()).toBe("failed");
  expect(appLock.getAppLockState().enabled).toBe(true);

  expect(await appLock.turnOffAppLock()).toBe("confirmed");
  expect(appLock.getAppLockState().enabled).toBe(false);
  expect(stored.get("appLock.enabled")).toBe(false);
  expect(recentsHidden).toEqual([true, false]);
});

test("a phone whose screen lock was removed unlocks and turns app lock off", async () => {
  await turnOn(0);
  leaveFor(0);
  phone.results = [{ success: false, error: "not_enrolled" }];

  expect(await appLock.unlockApp()).toBe("noScreenLock");

  expect(appLock.getAppLockState()).toMatchObject({ enabled: false, locked: false });
});

const { withOwnScreen } = await import("./ownScreen.ts");

const openOwnScreen = () => {
  let close = () => {};
  const screen = withOwnScreen(
    () =>
      new Promise<void>((resolve) => {
        close = resolve;
      }),
  );
  return async () => {
    close();
    await screen;
  };
};

const openOwnScreenFor = (ms: number) =>
  withOwnScreen(async () => {
    changeTo("background");
    passTime(ms);
    changeTo("active");
  });

test("'Immediately' doesn't lock after a screen the app opened itself", async () => {
  await turnOn(0);

  await openOwnScreenFor(30_000);

  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: false });
});

test("time on a screen the app opened still counts towards 1 or 5 minutes", async () => {
  await turnOn(60_000);

  await openOwnScreenFor(61_000);

  expect(appLock.getAppLockState().locked).toBe(true);
});

test("'Immediately' still locks after 5 minutes on a screen the app opened", async () => {
  await turnOn(0);

  await openOwnScreenFor(300_000);

  expect(appLock.getAppLockState().locked).toBe(true);
});

test("a return that arrives before the app's own screen finishes is settled when it closes", async () => {
  await turnOn(60_000);
  let close = () => {};

  const screen = withOwnScreen(
    () =>
      new Promise<void>((resolve) => {
        changeTo("background");
        passTime(120_000);
        changeTo("active");
        close = resolve;
      }),
  );
  expect(appLock.getAppLockState().locked).toBe(false);

  close();
  await screen;
  expect(appLock.getAppLockState().locked).toBe(true);
});

test("an unlock prompt refused before the app is on screen is asked once it arrives", async () => {
  await turnOn(300_000);
  phone.prompts = 0;
  appState.currentState = "background";
  appLock.startAppLock();
  const { promptRequest } = appLock.getAppLockState();

  expect(await appLock.unlockApp()).toBe("failed");
  expect(phone.prompts).toBe(0);
  changeTo("active");

  expect(appLock.getAppLockState().promptRequest).toBe(promptRequest + 1);
  changeTo("background");
  changeTo("active");
  expect(appLock.getAppLockState().promptRequest).toBe(promptRequest + 2);
});

test("leaving while the app's own screen is open covers the app until that screen closes", async () => {
  await turnOn(0);
  const close = openOwnScreen();

  changeTo("background");
  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: true });
  passTime(10_000);
  changeTo("active");
  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: true });

  await close();
  expect(appLock.getAppLockState()).toMatchObject({ locked: false, away: false });
});

test("a screen the app opened that never closes stops holding off the lock after 5 minutes", async () => {
  await turnOn(60_000);
  const close = openOwnScreen();

  leaveFor(300_000);

  expect(appLock.getAppLockState()).toMatchObject({ locked: true, away: false });
  await close();
});

test("a screen lost with its old window doesn't stop leaving from locking in the new one", async () => {
  await turnOn(0);
  const close = openOwnScreen();
  appLock.startAppLock();
  expect(await appLock.unlockApp()).toBe("confirmed");

  changeTo("background");

  expect(appLock.getAppLockState()).toMatchObject({ locked: true, away: false });
  changeTo("active");
  await close();
});

test("the relock time chosen by the time the app comes back is the one that applies", async () => {
  await turnOn(300_000);
  changeTo("background");
  passTime(120_000);
  expect(await appLock.changeRelockAfter(60_000)).toBe("confirmed");
  changeTo("active");
  expect(appLock.getAppLockState().locked).toBe(true);
});

test("a longer relock time needs the phone's screen lock, and a shorter one doesn't", async () => {
  await turnOn(60_000);
  phone.prompts = 0;

  phone.results = [{ success: false, error: "user_cancel" }];
  expect(await appLock.changeRelockAfter(300_000)).toBe("failed");
  expect(appLock.getAppLockState().relockAfter).toBe(60_000);

  expect(await appLock.changeRelockAfter(300_000)).toBe("confirmed");
  expect(appLock.getAppLockState().relockAfter).toBe(300_000);
  expect(phone.prompts).toBe(2);

  expect(await appLock.changeRelockAfter(0)).toBe("confirmed");
  expect(appLock.getAppLockState().relockAfter).toBe(0);
  expect(phone.prompts).toBe(2);
});
