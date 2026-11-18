import { storage } from "./storage.ts";

export const onboardingStorageKey = (userId: string) => `onboarding.${userId}`;

export const hasPendingOnboarding = (userId: string) =>
  storage.getString(onboardingStorageKey(userId)) !== undefined;
