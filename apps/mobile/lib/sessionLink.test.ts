import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDeviceKeyPair, sealSessionLinkChallenge } from "@openbeacon/encryption";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

const deviceKey = createDeviceKeyPair();
const otherKey = createDeviceKeyPair();
const device = { deviceId: "device-1", privateKey: deviceKey.privateKey, userId: "user-1" };
const calls: string[] = [];
let sealedTo = deviceKey.publicKey;
let alreadyLinked = false;
let registered: typeof device | null = device;
let release: () => void = () => {};
let challengeError: Error | null = null;
let now = 0;
const alerts: string[] = [];

const sessionChallenge = mock(async ({ deviceId }: { deviceId: string }) => {
  calls.push(`challenge:${deviceId}`);
  await new Promise<void>((resolve) => {
    release = resolve;
  });
  if (challengeError) throw challengeError;
  if (alreadyLinked) return { linked: true as const };
  return {
    linked: false as const,
    sealed: sealSessionLinkChallenge({
      challenge: new Uint8Array(32).fill(7),
      deviceId,
      devicePublicKey: sealedTo,
      userId: "user-1",
    }),
  };
});
const linkSession = mock(async ({ answer, deviceId }: { answer: string; deviceId: string }) => {
  calls.push(`link:${deviceId}:${answer}`);
  return { linked: true };
});
const invalidateQueries = mock(async () => {
  calls.push("invalidate");
});

mock.module("./api.ts", () => ({
  queryClient: { invalidateQueries },
  trpcClient: {
    device: {
      linkSession: { mutate: linkSession },
      sessionChallenge: { mutate: sessionChallenge },
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  getRegisteredDeviceKey: async () => registered,
}));

mock.module("./auth-client.ts", () => ({
  authClient: { getSession: async () => ({ data: { session: { token: "token-1" } } }) },
}));

const signOutOfThisPhone = mock(
  async (input: { removeThisPhone: boolean; sessionTokenToRevoke: string | null }) => {
    calls.push(`signOut:${input.removeThisPhone}:${input.sessionTokenToRevoke}`);
    return { status: "signedOut" as const };
  },
);
mock.module("./signOut.ts", () => ({ signOutOfThisPhone }));

mock.module("expo-router", () => ({
  router: { replace: (target: string) => calls.push(`navigate:${target}`) },
}));

mock.module("./alert.ts", () => ({
  Alert: { alert: (title: string, message: string) => alerts.push(`${title}|${message}`) },
}));

Date.now = () => now;

const httpStatuses: Record<string, number> = {
  FORBIDDEN: 403,
  INTERNAL_SERVER_ERROR: 500,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
  TOO_MANY_REQUESTS: 429,
  UNAUTHORIZED: 401,
};

const refusal = (code: string, cause: string | null = null) =>
  TRPCClientError.from({
    error: {
      code: -32003,
      data: { cause, code, httpStatus: httpStatuses[code] },
      message: "Refused",
    },
  });

const { handleDeviceUnverified, linkSessionToDevice, signOutAfterRefusedSessionLink } =
  await import("./sessionLink.ts");

const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

describe("linking this sign-in to the phone", () => {
  beforeEach(() => {
    calls.length = 0;
    alerts.length = 0;
    sealedTo = deviceKey.publicKey;
    alreadyLinked = false;
    challengeError = null;
    registered = device;
    now += 60_000;
  });

  test("answers the challenge with the phone's key", async () => {
    const linking = linkSessionToDevice(device);
    await settle();
    release();
    await linking;

    expect(calls).toEqual([
      "challenge:device-1",
      "link:device-1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    ]);
  });

  test("a burst of unverified errors proves the phone once, then refetches", async () => {
    const burst = [handleDeviceUnverified(), handleDeviceUnverified(), handleDeviceUnverified()];
    await settle();
    release();
    await Promise.all(burst);

    expect(calls).toEqual([
      "challenge:device-1",
      "link:device-1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      "invalidate",
    ]);
  });

  test("a session that's already linked skips the answer", async () => {
    alreadyLinked = true;
    const linking = linkSessionToDevice(device);
    await settle();
    release();
    await linking;

    expect(calls).toEqual(["challenge:device-1"]);
  });

  test("does nothing without a registered phone", async () => {
    registered = null;
    await handleDeviceUnverified();

    expect(calls).toEqual([]);
  });

  test("a challenge sealed to another key fails without sending an answer, and waits before retrying", async () => {
    sealedTo = otherKey.publicKey;
    const linking = linkSessionToDevice(device);
    await settle();
    release();
    await expect(linking).rejects.toThrow("couldn't confirm");

    const handling = handleDeviceUnverified();
    await settle();
    release();
    await handling;
    calls.length = 0;
    await handleDeviceUnverified();

    expect(calls).toEqual([]);
  });

  test("a refused link signs out of this phone once and asks to sign in again", async () => {
    challengeError = refusal("FORBIDDEN");
    const burst = [handleDeviceUnverified(), handleDeviceUnverified(), handleDeviceUnverified()];
    await settle();
    release();
    await Promise.all(burst);
    now += 20_000;
    challengeError = null;
    const next = handleDeviceUnverified();
    await settle();
    release();
    await next;

    expect(calls.slice(0, 3)).toEqual([
      "challenge:device-1",
      "signOut:false:token-1",
      "navigate:/",
    ]);
    expect(calls.filter((call) => call.startsWith("signOut"))).toHaveLength(1);
    expect(alerts).toEqual(["You’ve been signed out|Sign in again to keep using this phone."]);
  });

  test("a network failure doesn't sign out and retries only after the back-off", async () => {
    challengeError = TRPCClientError.from(new TypeError("Network request failed"));
    const first = handleDeviceUnverified();
    await settle();
    release();
    await first;
    now += 5_000;
    await handleDeviceUnverified();
    expect(calls).toEqual(["challenge:device-1"]);

    challengeError = null;
    now += 6_000;
    const retry = handleDeviceUnverified();
    await settle();
    release();
    await retry;

    expect(calls).toEqual([
      "challenge:device-1",
      "challenge:device-1",
      "link:device-1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      "invalidate",
    ]);
    expect(alerts).toEqual([]);
  });

  test("a removed phone is left to the wipe instead of signing out here", async () => {
    challengeError = refusal("UNAUTHORIZED", deviceRemovedCause);
    const handling = handleDeviceUnverified();
    await settle();
    release();
    await handling;

    expect(calls).toEqual(["challenge:device-1"]);
    expect(alerts).toEqual([]);
  });

  for (const code of ["INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE", "TOO_MANY_REQUESTS"]) {
    test(`${code} from the server doesn't sign out and retries only after the back-off`, async () => {
      challengeError = refusal(code);
      const first = handleDeviceUnverified();
      await settle();
      release();
      await first;
      now += 5_000;
      await handleDeviceUnverified();

      expect(calls).toEqual(["challenge:device-1"]);
      expect(alerts).toEqual([]);

      challengeError = null;
      now += 6_000;
      const retry = handleDeviceUnverified();
      await settle();
      release();
      await retry;

      expect(calls.filter((call) => call.startsWith("signOut"))).toEqual([]);
      expect(calls.at(-1)).toBe("invalidate");
    });
  }

  test("a refused link seen by both the recovery and another caller signs out and alerts once", async () => {
    challengeError = refusal("FORBIDDEN");
    const direct = linkSessionToDevice(device).catch(() => signOutAfterRefusedSessionLink());
    const recovery = handleDeviceUnverified();
    await settle();
    release();
    await Promise.all([recovery, direct]);

    expect(calls.filter((call) => call.startsWith("signOut"))).toHaveLength(1);
    expect(alerts).toEqual(["You’ve been signed out|Sign in again to keep using this phone."]);
  });
});
