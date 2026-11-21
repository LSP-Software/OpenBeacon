export type OnboardingStep =
  "restore" | "name" | "notifications" | "location" | "background" | "recovery" | "appLock";

export type OnboardingKind = "newAccount" | "newDevice" | "returning";

export type OnboardingProgress = {
  kind: OnboardingKind;
  steps: OnboardingStep[] | null;
  done: OnboardingStep[];
};
