import { beforeEach, describe, expect, mock, test } from "bun:test";
import { deviceRemovedCause, deviceUnverifiedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

const secureStoreValues = new Map<string, string>();
const storageValues = new Map<string, string | boolean>();
const events: string[] = [];
const removalHeaders: Array<string | undefined> = [];
let removalError: Error | null = null;
let removalErrors: Error[] = [];
let challengeError: Error | null = null;
let signOutError: Error | null = null;
let removedErrorDuringRemoval = false;

mock.module("./pendingJoinCode.ts", () => ({ clearPendingJoinCodes: () => {} }));
mock.module("expo-router", () => ({
  router: {
    replace: (target: unknown) => {
      events.push(`navigate:${String(target)}`);
    },
  },
}));
mock.module("expo-device", () => ({ modelName: "Pixel 8" }));

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    secureStoreValues.delete(key);
  },
  getItemAsync: async (key: string) => secureStoreValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureStoreValues.set(key, value);
  },
}));

mock.module("./storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => storageValues.get(key) === true,
    getString: (key: string) => {
      const value = storageValues.get(key);
      return typeof value === "string" ? value : undefined;
    },
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string | boolean) => {
      storageValues.set(key, value);
    },
  },
}));

const readHeaderDeviceId = async () => {
  const { readRegisteredDevice } = await import("./registeredDevice.ts");
  return (await readRegisteredDevice())?.deviceId;
};

mock.module("./api.ts", () => ({
  queryClient: {
    cancelQueries: async () => {},
    clear: () => {},
    getQueryData: () => undefined,
  },
  trpc: { accountRecovery: { status: { queryKey: () => [["accountRecovery", "status"]] } } },
  trpcClient: {
    account: {
      removeThisDevice: {
        mutate: async () => {
          events.push("removeThisDevice");
          removalHeaders.push(await readHeaderDeviceId());
          const queued = removalErrors.shift();
          if (queued) throw queued;
          if (removalError) throw removalError;
          if (removedErrorDuringRemoval) {
            const { handleDeviceRemoved } = await import("./deviceRemoved.ts");
            void handleDeviceRemoved();
          }
          return {};
        },
      },
    },
    device: {
      sessionChallenge: {
        mutate: async () => {
          events.push("sessionChallenge");
          if (challengeError) throw challengeError;
          return { linked: true };
        },
      },
    },
    auth: {
      deviceKeyContext: { query: async () => ({ recipients: [], userId: "user-a" }) },
      registerDeviceKey: { mutate: async () => ({}) },
    },
  },
}));

mock.module("./auth-client.ts", () => ({
  SESSION_TOKEN_TO_REVOKE_KEY: "sessionTokenToRevokeOnNextLogin",
  authClient: {
    signOut: async () => {
      events.push("signOut");
      if (signOutError) throw signOutError;
      return { error: null };
    },
  },
}));

mock.module("./tracking.ts", () => ({
  deleteQueuedTrackingPoints: async () => {
    events.push("deleteQueue");
  },
  prepareTrackingSignOut: async () => {
    events.push(`prepare:${await readHeaderDeviceId()}`);
  },
  resumeTracking: () => {
    events.push("resumeTracking");
  },
  revokeTrackingAccess: async () => {},
}));

mock.module("./trackingEvents.ts", () => ({
  requestTrackingSync: () => {
    events.push("requestTrackingSync");
  },
}));

mock.module("./groupColor.ts", () => ({ clearGroupColors: () => {} }));
mock.module("./trackingKeyCheck.ts", () => ({ clearTrackingKeyCheck: () => {} }));
mock.module("./trackingUploadTime.ts", () => ({ clearTrackingUploadTimes: () => {} }));

const { cancelDeviceKeyRegistrations, ensureDeviceKeyRegistration } =
  await import("./deviceKeys.ts");
const { signOutOfThisPhone } = await import("./signOut.ts");

describe("signing out of this phone", () => {
  beforeEach(() => {
    cancelDeviceKeyRegistrations();
    secureStoreValues.clear();
    storageValues.clear();
    events.length = 0;
    removalHeaders.length = 0;
    removalError = null;
    removalErrors = [];
    challengeError = null;
    signOutError = null;
    removedErrorDuringRemoval = false;
  });

  test("removing this phone sends its device id, then wipes its keys and signs out", async () => {
    const device = await ensureDeviceKeyRegistration();
    secureStoreValues.set("encryption.history.user-a.1", "history-1");

    const result = await signOutOfThisPhone({
      onSigningOut: () => events.push("signingOut"),
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "phoneRemoved" });
    expect(removalHeaders).toEqual([device.deviceId]);
    expect(events).toEqual([
      `prepare:${device.deviceId}`,
      "signingOut",
      "removeThisDevice",
      "deleteQueue",
      "signOut",
    ]);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
    expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(false);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
  });

  test("a removed error from another request during removal shares the wipe and doesn't open the removed screen", async () => {
    await ensureDeviceKeyRegistration();
    removedErrorDuringRemoval = true;

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "phoneRemoved" });
    expect(events.filter((event) => event === "signOut")).toHaveLength(1);
    expect(events.filter((event) => event === "deleteQueue")).toHaveLength(1);
    expect(events.some((event) => event.startsWith("navigate:"))).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  });

  test("a removal that never reaches the server doesn't sign out or wipe anything", async () => {
    const device = await ensureDeviceKeyRegistration();
    secureStoreValues.set("encryption.history.user-a.1", "history-1");
    removalError = TRPCClientError.from(new TypeError("Network request failed"));

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: "token-1",
    });

    expect(result).toEqual({ status: "serverUnreachable" });
    expect(events).toEqual([
      `prepare:${device.deviceId}`,
      "removeThisDevice",
      "resumeTracking",
      "requestTrackingSync",
    ]);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(secureStoreValues.get("encryption.history.user-a.1")).toBe("history-1");
    expect(secureStoreValues.has("sessionTokenToRevokeOnNextLogin")).toBe(false);
    expect(storageValues.get("encryption.device.registered")).toBeDefined();
  });

  test("a removal the server refuses still signs out but keeps the keys for the next sign-in", async () => {
    const device = await ensureDeviceKeyRegistration();
    removalError = TRPCClientError.from({
      error: { code: -32004, data: { code: "NOT_FOUND", httpStatus: 404 }, message: "Not found" },
    });

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "signedOut" });
    expect(removalHeaders).toEqual([device.deviceId]);
    expect(events).toEqual([`prepare:${device.deviceId}`, "removeThisDevice", "signOut"]);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
  });

  test("a retry after the phone was already removed wipes it as removed", async () => {
    await ensureDeviceKeyRegistration();
    removalError = TRPCClientError.from({
      error: {
        code: -32001,
        data: { cause: deviceRemovedCause, code: "UNAUTHORIZED", httpStatus: 401 },
        message: "This device was removed.",
      },
    });

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "phoneRemoved" });
    expect(events.some((event) => event.startsWith("navigate:"))).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  });

  test("a server fault while removing counts as unreachable and keeps this phone signed in", async () => {
    await ensureDeviceKeyRegistration();
    removalError = TRPCClientError.from({
      error: {
        code: -32603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
        message: "Internal server error",
      },
    });

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "serverUnreachable" });
    expect(events).not.toContain("signOut");
    expect(storageValues.get("encryption.device.registered")).toBeDefined();
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
  });

  test("a sign-in that isn't linked to this phone yet is linked, then the removal is retried", async () => {
    const device = await ensureDeviceKeyRegistration();
    removalErrors = [
      TRPCClientError.from({
        error: {
          code: -32003,
          data: { cause: deviceUnverifiedCause, code: "FORBIDDEN", httpStatus: 403 },
          message: "Confirm this phone first.",
        },
      }),
    ];

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "phoneRemoved" });
    expect(removalHeaders).toEqual([device.deviceId, device.deviceId]);
    expect(events).toEqual([
      `prepare:${device.deviceId}`,
      "removeThisDevice",
      "sessionChallenge",
      "removeThisDevice",
      "deleteQueue",
      "signOut",
    ]);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  });

  test("an unlinked sign-in that can't reach the server to link stays signed in", async () => {
    const device = await ensureDeviceKeyRegistration();
    removalErrors = [
      TRPCClientError.from({
        error: {
          code: -32003,
          data: { cause: deviceUnverifiedCause, code: "FORBIDDEN", httpStatus: 403 },
          message: "Confirm this phone first.",
        },
      }),
    ];
    challengeError = TRPCClientError.from(new TypeError("Network request failed"));

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "serverUnreachable" });
    expect(events).toEqual([
      `prepare:${device.deviceId}`,
      "removeThisDevice",
      "sessionChallenge",
      "resumeTracking",
      "requestTrackingSync",
    ]);
    expect(storageValues.get("encryption.device.registered")).toBeDefined();
  });

  test("trying again after this phone was already wiped reports it removed instead of still in Devices", async () => {
    removalError = TRPCClientError.from({
      error: {
        code: -32001,
        data: { code: "UNAUTHORIZED", httpStatus: 401 },
        message: "UNAUTHORIZED",
      },
    });

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });

    expect(result).toEqual({ status: "phoneRemoved" });
    expect(events).not.toContain("signOut");
  });

  test("a refused removal while another request is wiping this phone joins the wipe", async () => {
    await ensureDeviceKeyRegistration();
    removalError = TRPCClientError.from({
      error: {
        code: -32001,
        data: { code: "UNAUTHORIZED", httpStatus: 401 },
        message: "UNAUTHORIZED",
      },
    });
    const { handleDeviceRemoved } = await import("./deviceRemoved.ts");
    const wiping = handleDeviceRemoved();

    const result = await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: true,
      sessionTokenToRevoke: null,
    });
    await wiping;

    expect(result).toEqual({ status: "phoneRemoved" });
    expect(events.filter((event) => event === "signOut")).toHaveLength(1);
    expect(events.some((event) => event.startsWith("navigate:"))).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  });

  test("a plain sign-out forgets the registration only after signing out", async () => {
    const device = await ensureDeviceKeyRegistration();

    await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: false,
      sessionTokenToRevoke: null,
    });

    expect(events).toEqual([`prepare:${device.deviceId}`, "signOut"]);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
  });

  test("a sign-out that throws keeps the session token to revoke on the next sign-in", async () => {
    await ensureDeviceKeyRegistration();
    signOutError = new Error("offline");

    await signOutOfThisPhone({
      onSigningOut: () => {},
      removeThisPhone: false,
      sessionTokenToRevoke: "token-1",
    });

    expect(secureStoreValues.get("sessionTokenToRevokeOnNextLogin")).toBe("token-1");
    expect(storageValues.has("encryption.device.registered")).toBe(false);
  });
});
