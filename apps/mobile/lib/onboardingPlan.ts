import type { LocationPermissionState } from "./locationPermissions.ts";
import type { OnboardingKind, OnboardingProgress, OnboardingStep } from "./onboardingTypes.ts";

export const planOnboarding = ({
  kind,
  notificationsEnabled,
  location,
  hasRecoveryPhrase,
  appLockEnabled,
}: {
  kind: OnboardingKind;
  notificationsEnabled: boolean;
  location: Pick<LocationPermissionState, "missing">;
  hasRecoveryPhrase: boolean;
  appLockEnabled: boolean;
}): OnboardingStep[] => {
  const firstTimeOnThisPhone = kind !== "returning";
  const steps: OnboardingStep[] = [];
  if (kind === "newDevice") steps.push("restore");
  if (firstTimeOnThisPhone) steps.push("name");
  if (!notificationsEnabled) steps.push("notifications");
  if (location.missing.includes("foreground") || location.missing.includes("precise")) {
    steps.push("location");
  }
  if (location.missing.includes("foreground") || location.missing.includes("background")) {
    steps.push("background");
  }
  if (kind === "newAccount" && !hasRecoveryPhrase) steps.push("recovery");
  if (firstTimeOnThisPhone && !appLockEnabled) steps.push("appLock");
  return steps;
};

export const nextOnboardingStep = (progress: OnboardingProgress): OnboardingStep | null =>
  progress.steps?.find((step) => !progress.done.includes(step)) ?? null;

export const completeOnboardingSteps = (
  progress: OnboardingProgress,
  completed: OnboardingStep[],
): { progress: OnboardingProgress; next: OnboardingStep | null } => {
  const steps = progress.steps ?? [];
  const latest = Math.max(-1, ...completed.map((step) => steps.indexOf(step)));
  const done = [...new Set([...progress.done, ...steps.slice(0, latest + 1), ...completed])];
  const next =
    (latest === -1 ? undefined : steps[latest + 1]) ??
    steps.find((step) => !done.includes(step)) ??
    null;
  return { progress: { ...progress, done }, next };
};

export const onboardingPosition = (
  progress: OnboardingProgress,
  step: OnboardingStep,
): { number: number; total: number; previous: OnboardingStep | null } | null => {
  const steps = progress.steps ?? [];
  const index = steps.indexOf(step);
  if (index === -1) return null;
  const previous = steps[index - 1] ?? null;
  return {
    number: index + 1,
    total: steps.length,
    previous: previous === "restore" ? null : previous,
  };
};
