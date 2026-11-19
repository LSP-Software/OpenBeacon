import { tryCatch } from "@openbeacon/shared";
import { queryOptions } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import { useSyncExternalStore } from "react";
import { AppState, Keyboard, Platform, type AppStateStatus } from "react-native";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import type { RelockAfter } from "./appLockTypes.ts";
import { isOwnScreenOpen, onOwnScreenClosed, resetOwnScreens } from "./ownScreen.ts";
import { storage } from "./storage.ts";

const relockAfterOptions = [0, 60_000, 300_000] as const satisfies readonly RelockAfter[];

const ENABLED_KEY = "appLock.enabled";
const RELOCK_AFTER_KEY = "appLock.relockAfterMs";

const enabledAtStart = storage.getBoolean(ENABLED_KEY) === true;
const storedRelockAfter = storage.getNumber(RELOCK_AFTER_KEY);

let state = {
  enabled: enabledAtStart,
  relockAfter: relockAfterOptions.find((option) => option === storedRelockAfter) ?? 0,
  locked: enabledAtStart,
  away: false,
  promptRequest: 0,
};
const listeners = new Set<() => void>();
let authentication = 0;
let authenticating = false;
let backgroundedAt: number | null = null;
let leftDuring: "app" | "ownScreen" | "prompt" = "app";
let promptWhenActive = false;

const ownScreenOpen = () => authenticating || isOwnScreenOpen();

const setState = (next: Partial<typeof state>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

const lock = (promptRequest: number) => {
  Keyboard.dismiss();
  setState({ locked: true, away: false, promptRequest });
};

const hideRecentsPreview = (hidden: boolean) => {
  void tryCatch(OpenBeaconTracking.setRecentsPreviewHidden(hidden));
};

const setEnabled = (enabled: boolean) => {
  storage.set(ENABLED_KEY, enabled);
  hideRecentsPreview(enabled);
  setState({ enabled, locked: false });
};

const settleBackground = () => {
  if (AppState.currentState !== "active") return;
  let lockNow = false;
  let promptNow = false;
  if (backgroundedAt !== null) {
    const awayFor = OpenBeaconTracking.elapsedRealtime() - backgroundedAt;
    const longTrip = awayFor >= 300_000;
    if (ownScreenOpen() && !longTrip) return;
    const during = leftDuring;
    backgroundedAt = null;
    leftDuring = "app";
    lockNow =
      state.enabled &&
      !state.locked &&
      awayFor >= state.relockAfter &&
      (during === "app" || state.relockAfter > 0 || longTrip);
    promptNow =
      state.enabled &&
      state.locked &&
      (during === "app" ||
        (during === "prompt" && Platform.OS === "android" && Platform.Version >= 30));
  }
  if (lockNow) lock(state.promptRequest + 1);
  else if (promptNow || state.away) {
    setState({ away: false, promptRequest: state.promptRequest + (promptNow ? 1 : 0) });
  }
};

const handleAppStateChange = (next: AppStateStatus) => {
  if (next === "background") {
    if (backgroundedAt === null) {
      backgroundedAt = OpenBeaconTracking.elapsedRealtime();
      leftDuring = authenticating ? "prompt" : isOwnScreenOpen() ? "ownScreen" : "app";
    }
    if (!state.enabled) return;
    if (state.relockAfter === 0 && !ownScreenOpen()) lock(state.promptRequest);
    else setState({ away: true });
  }
  if (next === "active") {
    if (authenticating) {
      const pending = authentication;
      setTimeout(() => {
        if (authenticating && authentication === pending) {
          void tryCatch(LocalAuthentication.cancelAuthenticate());
        }
      }, 1_000);
    }
    const promptRequest = state.promptRequest;
    settleBackground();
    if (promptWhenActive && state.locked && state.promptRequest === promptRequest) {
      setState({ promptRequest: promptRequest + 1 });
    }
    promptWhenActive = false;
  }
};

onOwnScreenClosed(settleBackground);

let subscribed = false;

export const startAppLock = () => {
  resetOwnScreens();
  hideRecentsPreview(state.enabled);
  if (!subscribed) {
    AppState.addEventListener("change", handleAppStateChange);
    subscribed = true;
  }
  if (state.enabled) lock(state.promptRequest + 1);
};

export const getAppLockState = () => state;

export const useAppLock = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getAppLockState);

const hasScreenLock = async () => {
  const level = await tryCatch(LocalAuthentication.getEnrolledLevelAsync());
  return (
    (level.data ?? LocalAuthentication.SecurityLevel.NONE) >=
    LocalAuthentication.SecurityLevel.SECRET
  );
};

export const phoneScreenLockQueryOptions = queryOptions({
  queryKey: ["phoneScreenLock"],
  queryFn: hasScreenLock,
  staleTime: 0,
  networkMode: "always",
});

export const confirmWithPhoneLock = async (
  promptMessage: string,
): Promise<"confirmed" | "noScreenLock" | "lockedOut" | "failed"> => {
  if (authenticating) return "failed";
  if (AppState.currentState !== "active") {
    promptWhenActive = true;
    return "failed";
  }
  authentication += 1;
  authenticating = true;
  const result = await tryCatch(LocalAuthentication.authenticateAsync({ promptMessage }));
  authenticating = false;
  const outcome = result.error
    ? "failed"
    : result.data.success
      ? "confirmed"
      : result.data.error === "not_enrolled" || result.data.error === "passcode_not_set"
        ? "noScreenLock"
        : result.data.error === "lockout"
          ? "lockedOut"
          : "failed";
  if (outcome === "confirmed") {
    backgroundedAt = null;
    leftDuring = "app";
  }
  settleBackground();
  return outcome;
};

export const unlockApp = async () => {
  const result = await confirmWithPhoneLock("Unlock OpenBeacon");
  if (result === "confirmed") setState({ locked: false });
  if (result === "noScreenLock") setEnabled(false);
  return result;
};

export const turnOnAppLock = async () => {
  if (!(await hasScreenLock())) return "noScreenLock";
  const result = await confirmWithPhoneLock("Turn on app lock");
  if (result === "confirmed") setEnabled(true);
  return result;
};

export const turnOffAppLock = async () => {
  const result = await confirmWithPhoneLock("Turn off app lock");
  if (result === "confirmed" || result === "noScreenLock") setEnabled(false);
  return result;
};

export const changeRelockAfter = async (relockAfter: RelockAfter) => {
  if (relockAfter > state.relockAfter) {
    const result = await confirmWithPhoneLock("Change when app lock asks again");
    if (result !== "confirmed") return result;
  }
  storage.set(RELOCK_AFTER_KEY, relockAfter);
  setState({ relockAfter });
  return "confirmed";
};
