import { tryCatch } from "@openbeacon/shared";
import { type Href, router } from "expo-router";
import { z } from "zod";
import { trpcClient } from "./api.ts";
import { getAppLockState } from "./appLock.ts";
import { getLocationPermissionState } from "./locationPermissions.ts";
import { areNotificationsEnabled } from "./notifications.ts";
import {
  completeOnboardingSteps,
  nextOnboardingStep,
  onboardingPosition,
  planOnboarding,
} from "./onboardingPlan.ts";
import { onboardingStorageKey } from "./onboardingStorage.ts";
import type { OnboardingKind, OnboardingProgress, OnboardingStep } from "./onboardingTypes.ts";
import { openAppAfterSetup } from "./pendingJoinCode.ts";
import { readRegisteredDeviceNow } from "./registeredDevice.ts";
import { storage } from "./storage.ts";

const stepSchema = z.enum([
  "restore",
  "name",
  "sharing",
  "notifications",
  "location",
  "background",
  "recovery",
  "appLock",
]);
const progressSchema = z.object({
  kind: z.enum(["newAccount", "newDevice", "returning"]),
  steps: z.array(stepSchema).nullable(),
  done: z.array(stepSchema),
}) satisfies z.ZodType<OnboardingProgress>;

const stepRoutes = {
  restore: "/setup",
  name: "/setup/name",
  sharing: "/onboarding/sharing",
  notifications: "/onboarding/notifications",
  location: "/onboarding/location",
  background: "/onboarding/background",
  recovery: "/onboarding/recovery",
  appLock: "/onboarding/app-lock",
} as const satisfies Record<OnboardingStep, Href>;

const parseStored = (stored: string): unknown => {
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

const save = (userId: string, progress: OnboardingProgress) => {
  storage.set(onboardingStorageKey(userId), JSON.stringify(progress));
};

const currentUserId = () => readRegisteredDeviceNow()?.userId ?? null;

export const readOnboarding = (userId: string): OnboardingProgress | null => {
  const stored = storage.getString(onboardingStorageKey(userId));
  if (!stored) return null;
  const parsed = progressSchema.safeParse(parseStored(stored));
  return parsed.success ? parsed.data : null;
};

export const readCurrentOnboarding = () => {
  const userId = currentUserId();
  return userId ? readOnboarding(userId) : null;
};

export const startOnboarding = (userId: string, kind: OnboardingKind) => {
  save(userId, { kind, steps: null, done: [] });
};

export const readOnboardingPosition = (step: OnboardingStep) => {
  const progress = readCurrentOnboarding();
  return progress ? onboardingPosition(progress, step) : null;
};

export const planCurrentOnboarding = async (): Promise<OnboardingProgress | null> => {
  const userId = currentUserId();
  const progress = userId ? readOnboarding(userId) : null;
  if (!userId || !progress) return null;
  if (progress.steps) return progress;
  const [notifications, location, recovery] = await Promise.all([
    tryCatch(areNotificationsEnabled()),
    tryCatch(getLocationPermissionState()),
    tryCatch(trpcClient.accountRecovery.status.query()),
  ]);
  const planned = {
    ...progress,
    steps: planOnboarding({
      kind: progress.kind,
      notificationsEnabled: notifications.data ?? false,
      location: location.data ?? { missing: ["foreground"] },
      hasRecoveryPhrase: Boolean(recovery.data?.recoveryKey),
      appLockEnabled: getAppLockState().enabled,
    }),
  };
  save(userId, planned);
  return planned;
};

export const goToOnboardingStep = (step: OnboardingStep) => {
  router.replace(stepRoutes[step]);
};

const goToStepOrEnd = (kind: OnboardingKind, next: OnboardingStep | null) => {
  if (next) {
    goToOnboardingStep(next);
    return;
  }
  if (kind === "returning") {
    finishOnboarding();
    return;
  }
  router.replace("/onboarding/done");
};

export const continueOnboarding = (progress: OnboardingProgress) => {
  goToStepOrEnd(progress.kind, nextOnboardingStep(progress));
};

export const advanceOnboarding = (completed: OnboardingStep | OnboardingStep[]) => {
  const userId = currentUserId();
  const progress = userId ? readOnboarding(userId) : null;
  if (!userId || !progress?.steps) {
    openAppAfterSetup("/");
    return;
  }
  const result = completeOnboardingSteps(progress, [completed].flat());
  save(userId, result.progress);
  goToStepOrEnd(progress.kind, result.next);
};

export const finishOnboarding = () => {
  const userId = currentUserId();
  if (userId) storage.remove(onboardingStorageKey(userId));
  openAppAfterSetup("/(tabs)/map");
};
