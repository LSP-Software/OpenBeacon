import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDeviceKeyPair, sealSessionLinkChallenge } from "@openbeacon/encryption";

const deviceKey = createDeviceKeyPair();
const otherKey = createDeviceKeyPair();
const device = { deviceId: "device-1", privateKey: deviceKey.privateKey, userId: "user-1" };
const calls: string[] = [];
let sealedTo = deviceKey.publicKey;
let alreadyLinked = false;
let registered: typeof device | null = device;
let release: () => void = () => {};

const sessionChallenge = mock(async ({ deviceId }: { deviceId: string }) => {
  calls.push(`challenge:${deviceId}`);
  await new Promise<void>((resolve) => {
    release = resolve;
  });
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

const { handleDeviceUnverified, linkSessionToDevice } = await import("./sessionLink.ts");

const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

describe("linking this sign-in to the phone", () => {
  beforeEach(() => {
    calls.length = 0;
    sealedTo = deviceKey.publicKey;
    alreadyLinked = false;
    registered = device;
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
});
