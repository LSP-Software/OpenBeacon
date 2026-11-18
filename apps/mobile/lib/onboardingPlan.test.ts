import { describe, expect, test } from "bun:test";
import {
  completeOnboardingSteps,
  nextOnboardingStep,
  onboardingPosition,
  planOnboarding,
} from "./onboardingPlan.ts";

const nothingAllowed = {
  notificationsEnabled: false,
  location: { missing: ["foreground" as const] },
  hasRecoveryPhrase: false,
  appLockEnabled: false,
};
const everythingAllowed = {
  notificationsEnabled: true,
  location: { missing: [] },
  hasRecoveryPhrase: true,
  appLockEnabled: true,
};

describe("planOnboarding", () => {
  test("a new account goes through every step except restoring", () => {
    expect(planOnboarding({ kind: "newAccount", ...nothingAllowed })).toEqual([
      "name",
      "sharing",
      "notifications",
      "location",
      "background",
      "recovery",
      "appLock",
    ]);
  });

  test("a new phone on an existing account must restore first and never asks for a phrase", () => {
    expect(planOnboarding({ kind: "newDevice", ...nothingAllowed })).toEqual([
      "restore",
      "name",
      "sharing",
      "notifications",
      "location",
      "background",
      "appLock",
    ]);
  });

  test("signing in again on a set-up phone only asks for what is missing", () => {
    expect(planOnboarding({ kind: "returning", ...everythingAllowed })).toEqual([]);
    expect(
      planOnboarding({
        kind: "returning",
        ...everythingAllowed,
        notificationsEnabled: false,
        appLockEnabled: false,
        location: { missing: ["background"] },
      }),
    ).toEqual(["notifications", "background"]);
  });

  test("permissions already granted are skipped", () => {
    expect(planOnboarding({ kind: "newAccount", ...everythingAllowed })).toEqual([
      "name",
      "sharing",
    ]);
  });

  test("only missing precise location asks again for location but not background", () => {
    expect(
      planOnboarding({
        kind: "returning",
        ...everythingAllowed,
        location: { missing: ["precise"] },
      }),
    ).toEqual(["location"]);
  });

  test("a new account that already has a phrase skips the recovery step", () => {
    expect(
      planOnboarding({ kind: "newAccount", ...nothingAllowed, hasRecoveryPhrase: true }),
    ).not.toContain("recovery");
  });
});

describe("onboarding progress", () => {
  const progress = {
    kind: "newDevice" as const,
    steps: ["restore" as const, "name" as const, "sharing" as const, "appLock" as const],
    done: [],
  };

  test("completing a later step also completes the steps before it", () => {
    const { progress: next, next: step } = completeOnboardingSteps(progress, ["name"]);
    expect(next.done).toEqual(["restore", "name"]);
    expect(step).toBe("sharing");
    expect(nextOnboardingStep(next)).toBe("sharing");
  });

  test("there is no next step once everything is done", () => {
    const { progress: next, next: step } = completeOnboardingSteps(progress, ["appLock"]);
    expect(step).toBeNull();
    expect(nextOnboardingStep(next)).toBeNull();
  });

  test("going back two steps then continuing walks forward through the step in between", () => {
    const atAppLock = {
      ...progress,
      done: ["restore" as const, "name" as const, "sharing" as const],
    };

    const fromName = completeOnboardingSteps(atAppLock, ["name"]);
    expect(fromName.next).toBe("sharing");
    expect(fromName.progress.done).toEqual(atAppLock.done);

    expect(completeOnboardingSteps(fromName.progress, ["sharing"]).next).toBe("appLock");
  });

  test("completing several steps at once moves on from the latest of them", () => {
    const { progress: next, next: step } = completeOnboardingSteps(progress, ["sharing", "name"]);
    expect(next.done).toEqual(["restore", "name", "sharing"]);
    expect(step).toBe("appLock");
  });

  test("a completed step outside the plan never sends anyone back to a skipped step", () => {
    const location = {
      kind: "returning" as const,
      steps: ["notifications" as const, "location" as const, "recovery" as const],
      done: [],
    };

    const { progress: next, next: step } = completeOnboardingSteps(location, [
      "location",
      "background",
    ]);
    expect(next.done).toEqual(["notifications", "location", "background"]);
    expect(step).toBe("recovery");
  });

  test("only completing steps outside the plan carries on with the first unfinished step", () => {
    const halfway = { ...progress, done: ["restore" as const, "name" as const] };

    const { progress: next, next: step } = completeOnboardingSteps(halfway, ["background"]);
    expect(next.done).toEqual(["restore", "name", "background"]);
    expect(step).toBe("sharing");
    expect(completeOnboardingSteps(next, ["background"]).next).toBe("sharing");
  });

  test("with nothing left anywhere there is no next step", () => {
    const finished = { ...progress, done: [...progress.steps] };

    expect(completeOnboardingSteps(finished, ["background"]).next).toBeNull();
    expect(completeOnboardingSteps(finished, []).next).toBeNull();
    expect(completeOnboardingSteps({ ...progress, steps: null }, ["name"]).next).toBeNull();
  });

  test("no plan yet means no next step", () => {
    expect(nextOnboardingStep({ ...progress, steps: null })).toBeNull();
  });

  test("position counts every planned step and never goes back to restoring", () => {
    expect(onboardingPosition(progress, "name")).toEqual({
      number: 2,
      total: 4,
      previous: null,
    });
    expect(onboardingPosition(progress, "sharing")).toEqual({
      number: 3,
      total: 4,
      previous: "name",
    });
    expect(onboardingPosition(progress, "recovery")).toBeNull();
  });
});
