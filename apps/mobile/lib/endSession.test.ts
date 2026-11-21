import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDeviceKeyPair, createHistoryKeyPair, encodeBase64 } from "@openbeacon/encryption";
import { deviceRemovedCause, tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

const secureStoreValues = new Map<string, string>();
const storageValues = new Map<string, string | boolean>();
const navigations: unknown[] = [];
const queueDeletions: Array<{ deviceId: string | undefined; userId: string }> = [];
let signOuts = 0;
let picturesAtSignOut = -1;
let trackingRevocations = 0;
let pushTokenForgets = 0;
let eventNoticeClears: { keepSecurityAlerts: boolean }[] = [];
const registeredAtEventNoticeClears: boolean[] = [];
let googleSignInForgets = 0;
let googleSignOut: () => Promise<void> = async () => {};
let sessionUserId: string | null = "user-a";
let registerError: Error | null = null;
let stalledDelete: string | null = null;
let writeGate: Promise<void> | null = null;
let writesStarted: string[] = [];
let providersError: Error | null = null;
const providerRequests: unknown[] = [];
let recoveryStatus:
  { currentHistoryKey: { version: number }; recoveryKey?: object | null } | undefined = {
  currentHistoryKey: { version: 3 },
};

mock.module("./pendingJoinCode.ts", () => ({
  clearPendingJoinCodes: () => {
    for (const key of [...storageValues.keys()])
      if (key.startsWith("pendingJoinCode.")) storageValues.delete(key);
  },
}));
mock.module("expo-router", () => ({
  router: {
    replace: (target: unknown) => {
      navigations.push(target);
    },
  },
}));

mock.module("expo-device", () => ({
  DeviceType: { PHONE: 1, TABLET: 2 },
  deviceType: 1,
  modelName: "Pixel 8",
}));

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    if (key === stalledDelete) await new Promise(() => {});
    secureStoreValues.delete(key);
  },
  getItemAsync: async (key: string) => secureStoreValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    writesStarted.push(key);
    await writeGate;
    secureStoreValues.set(key, value);
  },
}));

mock.module("./storage.ts", () => ({
  storage: {
    getAllKeys: () => [...storageValues.keys()],
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

mock.module("./api.ts", () => ({
  queryClient: {
    cancelQueries: async () => {},
    clear: () => {},
    getQueryData: () => recoveryStatus,
  },
  trpc: { accountRecovery: { status: { queryKey: () => [["accountRecovery", "status"]] } } },
  trpcClient: {
    auth: {
      providers: {
        query: async (_input: undefined, options: unknown) => {
          providerRequests.push(options);
          if (providersError) throw providersError;
          return { emailPassword: true, google: false };
        },
      },
      deviceKeyContext: {
        query: async () => {
          if (!sessionUserId) throw new Error("UNAUTHORIZED");
          return { recipients: [], userId: sessionUserId };
        },
      },
      registerDeviceKey: {
        mutate: async () => {
          if (registerError) throw registerError;
          return {};
        },
      },
    },
  },
}));

mock.module("./auth-client.ts", () => ({
  saveSessionTokenToRevoke: async (token: string) => {
    secureStoreValues.set("sessionTokenToRevokeOnNextLogin", token);
  },
  forgetSessionTokenToRevoke: async () => {
    secureStoreValues.delete("sessionTokenToRevokeOnNextLogin");
  },
  authClient: {
    signOut: async () => {
      signOuts += 1;
      picturesAtSignOut = [...cachedFiles].filter((file) =>
        file.startsWith("cache/images/"),
      ).length;
      return { error: null };
    },
  },
}));

mock.module("./auth.ts", () => ({
  forgetGoogleSignIn: async () => {
    googleSignInForgets += 1;
    await googleSignOut();
  },
}));

mock.module("./tracking.ts", () => ({
  deleteQueuedTrackingPoints: async (input: { deviceId: string | undefined; userId: string }) => {
    queueDeletions.push(input);
  },
  revokeTrackingAccess: async () => {
    trackingRevocations += 1;
  },
  forgetPushToken: async () => {
    pushTokenForgets += 1;
    return null;
  },
}));

mock.module("./notifications.ts", () => ({
  clearEventNotices: async (options: { keepSecurityAlerts: boolean }) => {
    eventNoticeClears.push(options);
    registeredAtEventNoticeClears.push(storageValues.has("encryption.device.registered"));
  },
}));

const cachedFiles = new Set<string>();
let imageKeyCheckResets = 0;

mock.module("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    path: string;
    constructor(...parts: string[]) {
      this.path = parts.join("/");
    }
    get exists() {
      return [...cachedFiles].some((file) => file.startsWith(`${this.path}/`));
    }
    delete = () => {
      for (const file of [...cachedFiles]) {
        if (file.startsWith(`${this.path}/`)) cachedFiles.delete(file);
      }
    };
  },
  File: class {},
}));

mock.module("./groupColor.ts", () => ({ clearGroupColors: () => {} }));
mock.module("./imageKeySelfCheck.ts", () => ({
  resetImageKeyCheck: () => {
    imageKeyCheckResets += 1;
  },
}));
mock.module("./trackingKeyCheck.ts", () => ({ clearTrackingKeyCheck: () => {} }));
mock.module("./trackingUploadTime.ts", () => ({ clearTrackingUploadTimes: () => {} }));

const { ensureDeviceKeyRegistration } = await import("./deviceKeys.ts");
const { handleDeviceRemoved, wipeAfterRemovingThisPhone } = await import("./deviceRemoved.ts");
const { endSession, readLostSessions, settleLostSessions } = await import("./endSession.ts");
const { storeHistoryKey } = await import("./historyKeys.ts");
const { finishHistoryExport, startHistoryExport } = await import("./historyExportFile.ts");
const baseUrl = (await import("./currentServer.ts")).getBaseUrl();
const pendingSharingKey = `locationSharing.pending.${JSON.stringify([baseUrl, "user-a", "device"])}`;
const accountStorageKeys = [
  `places.known.${JSON.stringify([baseUrl, "user-a", "family"])}`,
  `places.revision.${JSON.stringify([baseUrl, "user-a", "family"])}`,
  `places.alertsCursor.${JSON.stringify([baseUrl, "user-a"])}`,
  `notices.cursor.${JSON.stringify([baseUrl, "user-a"])}`,
  `locationSharing.synced.${JSON.stringify([baseUrl, "user-a", "device-a"])}`,
  `locationSharing.localPause.${JSON.stringify([baseUrl, "user-a", "device-a"])}`,
  `historyShareNotice.${JSON.stringify([baseUrl, "user-a"])}`,
  "map.hiddenGroups.user-a",
  "map.peopleTrayOpen.user-a",
  "timeline.groupId.user-a",
  "groupHistory.seenAt.user-a.family",
  "recovery.restoreCardDismissed.user-a",
  "recovery.promptDismissed.user-a",
  "recovery.historyWarningDismissedFrom.user-a.family",
  "encryption.history.unpublished.user-a",
  "onboarding.user-a",
];
const otherAccountStorageKeys = [
  `places.known.${JSON.stringify([baseUrl, "user-ab", "family"])}`,
  "map.hiddenGroups.user-ab",
  "map.showSymbols",
];

const removedError = () =>
  new TRPCClientError("This device was removed.", {
    result: {
      error: {
        code: -32001,
        message: "This device was removed.",
        data: {
          cause: deviceRemovedCause,
          reason: deviceRemovedCause,
          code: "UNAUTHORIZED",
          httpStatus: 401,
        },
      },
    },
  });

const seedSignedOutPhone = async () => {
  const key = createDeviceKeyPair();
  const device = { deviceId: "device-a" };
  storageValues.set("encryption.device.id.user-a", device.deviceId);
  storageValues.set("encryption.device.publicKey.user-a", key.publicKey);
  secureStoreValues.set(
    "encryption.device.privateKey.user-a",
    encodeBase64(key.privateKey.expose()),
  );
  storageValues.set(`encryption.device.active.${device.deviceId}`, true);
  secureStoreValues.set("encryption.history.user-a.1", "history-1");
  secureStoreValues.set("encryption.history.user-a.3", "history-3");
  secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
  return device;
};

const expectWiped = (deviceId: string) => {
  expect(storageValues.has("encryption.device.id.user-a")).toBe(false);
  expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(false);
  expect(secureStoreValues.has("encryption.history.user-a.3")).toBe(false);
  expect(storageValues.has(`encryption.device.active.${deviceId}`)).toBe(false);
  expect(secureStoreValues.has(`encryption.deviceLink.user-a.${deviceId}`)).toBe(false);
};

describe("wiping a removed phone", () => {
  beforeEach(() => {
    registeredAtEventNoticeClears.length = 0;
    secureStoreValues.clear();
    storageValues.clear();
    navigations.length = 0;
    queueDeletions.length = 0;
    signOuts = 0;
    googleSignInForgets = 0;
    googleSignOut = async () => {};
    sessionUserId = "user-a";
    registerError = null;
    stalledDelete = null;
    writeGate = null;
    writesStarted = [];
    providersError = null;
    providerRequests.length = 0;
  });

  test("wipes a signed-in phone using its registration", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    storageValues.set(`encryption.device.active.${device.deviceId}`, true);
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
    storageValues.set("locationSharing.pending.queued-pause", "pause");

    await endSession({ reason: "phoneRemoved" });

    expectWiped(device.deviceId);
    expect(storageValues.has("locationSharing.pending.queued-pause")).toBe(false);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(signOuts).toBe(1);
    sessionUserId = "user-a";
    const replacement = await ensureDeviceKeyRegistration();
    expect(replacement.deviceId).not.toBe(device.deviceId);
    expect(replacement.publicKey).not.toBe(device.publicKey);
  });

  test("removing the phone while a History key is being saved refuses the save and leaves no key", async () => {
    const device = await ensureDeviceKeyRegistration();
    let release = () => {};
    writeGate = new Promise((resolve) => {
      release = resolve;
    });
    const storing = tryCatch(
      storeHistoryKey({
        privateKey: createHistoryKeyPair().privateKey,
        userId: "user-a",
        version: 2,
      }),
    );
    while (!writesStarted.includes("encryption.history.user-a.2")) await Bun.sleep(1);

    const ending = endSession({ reason: "phoneRemoved" });
    await Bun.sleep(20);
    release();
    await ending;

    expect((await storing).error).toBeInstanceOf(Error);
    expectWiped(device.deviceId);
    expect(secureStoreValues.has("encryption.history.user-a.2")).toBe(false);
  });

  test("wipes a phone that signed out normally, using the signed-in account", async () => {
    const device = await seedSignedOutPhone();

    await endSession({ reason: "phoneRemoved" });

    expectWiped(device.deviceId);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(signOuts).toBe(1);
  });

  test("still signs out when the account can't be found", async () => {
    const device = await seedSignedOutPhone();
    sessionUserId = null;

    await endSession({ reason: "phoneRemoved" });

    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(queueDeletions).toEqual([]);
    expect(signOuts).toBe(1);
  });

  test("several removed errors at once wipe once and open the removed screen once", async () => {
    const device = await seedSignedOutPhone();
    const first = handleDeviceRemoved();
    const second = handleDeviceRemoved();
    expect(second).toBe(first);
    await first;

    expectWiped(device.deviceId);
    expect(signOuts).toBe(1);
    expect(navigations).toEqual(["/device-removed"]);
  });

  test("a wipe stopped part-way keeps the registration, so a later wipe still finds this phone and finishes", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    secureStoreValues.set("encryption.history.user-a.1", "history-1");
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
    stalledDelete = "encryption.device.privateKey.user-a";

    void endSession({ reason: "phoneRemoved" });
    for (
      let index = 0;
      index < 200 && secureStoreValues.has("encryption.history.user-a.1");
      index++
    )
      await Promise.resolve();
    for (let index = 0; index < 50; index++) await Promise.resolve();

    expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(false);
    expect(storageValues.has("encryption.device.registered")).toBe(true);
    stalledDelete = null;
    queueDeletions.length = 0;

    await handleDeviceRemoved();

    expectWiped(device.deviceId);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(navigations).toEqual(["/device-removed"]);
  });

  test("removing this phone while a removed error is wiping it wipes once and doesn't open the removed screen", async () => {
    const device = await seedSignedOutPhone();
    const fromRemovedError = handleDeviceRemoved();
    const fromRemoval = wipeAfterRemovingThisPhone();
    expect(fromRemoval).toBe(fromRemovedError);
    await fromRemoval;

    expectWiped(device.deviceId);
    expect(signOuts).toBe(1);
    expect(navigations).toEqual([]);
  });

  test("a removed error while removing this phone joins its wipe without opening the removed screen", async () => {
    await seedSignedOutPhone();
    const fromRemoval = wipeAfterRemovingThisPhone();
    const fromRemovedError = handleDeviceRemoved();
    expect(fromRemovedError).toBe(fromRemoval);
    await fromRemovedError;

    expect(signOuts).toBe(1);
    expect(navigations).toEqual([]);
  });

  test("a registration refused as removed leaves the cleanup to the wipe", async () => {
    const device = await seedSignedOutPhone();
    registerError = new TRPCClientError("This device was removed.", {
      result: {
        error: {
          code: -32600,
          message: "This device was removed.",
          data: { cause: deviceRemovedCause, reason: deviceRemovedCause },
        },
      },
    });

    await expect(ensureDeviceKeyRegistration()).rejects.toBeInstanceOf(TRPCClientError);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    await endSession({ reason: "phoneRemoved" });

    expectWiped(device.deviceId);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
  });

  test("a phone whose session was lost and which the server reports removed is wiped and shows the removed screen", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
    providersError = removedError();

    await endSession({ reason: "sessionLost" });

    expect(providerRequests).toEqual([{ context: { handleDeviceErrors: false } }]);
    expectWiped(device.deviceId);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(navigations).toEqual(["/device-removed"]);
  });

  test("a phone whose session was lost but is still in Devices only forgets its registration", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;

    await endSession({ reason: "sessionLost" });

    expect(providerRequests).toHaveLength(1);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(signOuts).toBe(0);
    expect(navigations).toEqual([]);
  });

  test("a lost session that can't reach the server forgets the registration without wiping", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    providersError = TRPCClientError.from(new TypeError("Network request failed"));

    await endSession({ reason: "sessionLost" });

    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(navigations).toEqual([]);
  });

  test("signing out forgets the Google account the phone signed in with", async () => {
    await ensureDeviceKeyRegistration();

    await endSession({ reason: "signedOut" });

    expect(googleSignInForgets).toBe(1);
  });

  test("a Google sign-out that fails still signs out", async () => {
    await ensureDeviceKeyRegistration();
    googleSignOut = async () => {
      throw new Error("[SIGN_OUT_FAILED] Credential Manager failed");
    };

    const result = await endSession({ reason: "signedOut" });

    expect(googleSignInForgets).toBe(1);
    expect(signOuts).toBe(1);
    expect(result.signedOut).toBe(true);
  });

  test("a lost session keeps the Google account until the person signs out", async () => {
    await ensureDeviceKeyRegistration();
    sessionUserId = null;

    await endSession({ reason: "sessionLost" });

    expect(googleSignInForgets).toBe(0);
  });

  test("a lost session without a registration sends nothing", async () => {
    await seedSignedOutPhone();

    await endSession({ reason: "sessionLost" });

    expect(providerRequests).toEqual([]);
    expect(signOuts).toBe(0);
  });

  test("a lost session still deletes decrypted pictures when it stops early", async () => {
    await seedSignedOutPhone();
    cachedFiles.add("cache/images/0d6c8c2e-2b1a-4c55-9a4e-6f1b2f3c4d5e");

    await endSession({ reason: "sessionLost" });

    expect([...cachedFiles].filter((file) => file.startsWith("cache/images/"))).toEqual([]);
  });
});

describe("ending a session", () => {
  beforeEach(() => {
    registeredAtEventNoticeClears.length = 0;
    secureStoreValues.clear();
    storageValues.clear();
    navigations.length = 0;
    queueDeletions.length = 0;
    signOuts = 0;
    trackingRevocations = 0;
    pushTokenForgets = 0;
    sessionUserId = "user-a";
    providersError = null;
    providerRequests.length = 0;
    recoveryStatus = { currentHistoryKey: { version: 3 } };
  });

  test.each([
    [{ recoveryKey: {} }, { hasRecoveryPhrase: true }],
    [{ recoveryKey: null }, { hasRecoveryPhrase: false }],
    [undefined, {}],
  ] as const)(
    "a lost session remembers whether the account had a recovery phrase (%p)",
    async (status, expected) => {
      await seedSignedInPhone();
      recoveryStatus = status ? { currentHistoryKey: { version: 3 }, ...status } : undefined;

      await endSession({ reason: "serverChanged" });

      expect(readLostSessions()).toEqual([
        { userId: "user-a", lostAt: expect.any(Number), ...expected },
      ]);
    },
  );

  const seedSignedInPhone = async () => {
    const device = await ensureDeviceKeyRegistration();
    storageValues.set(`encryption.device.active.${device.deviceId}`, true);
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
    secureStoreValues.set("sessionTokenToRevokeOnNextLogin", "old-token");
    storageValues.set(pendingSharingKey, "change");
    storageValues.set("pendingJoinCode.user-a", "join-code");
    storageValues.set("api_compatibility", "saved-verdict");
    for (const key of [...accountStorageKeys, ...otherAccountStorageKeys]) {
      storageValues.set(key, "stored");
    }
    return device;
  };

  const observe = (deviceId: string) => ({
    signedOut: signOuts > 0,
    trackingRevoked: trackingRevocations > 0,
    pushTokenForgotten: pushTokenForgets > 0,
    registration: storageValues.has("encryption.device.registered"),
    queuedPoints: queueDeletions.length === 0,
    pendingSharingChanges: storageValues.has(pendingSharingKey),
    pendingJoinCodes: storageValues.has("pendingJoinCode.user-a"),
    deviceKey: secureStoreValues.has("encryption.device.privateKey.user-a"),
    historyKeys: secureStoreValues.has("encryption.history.user-a.3"),
    savedDeviceLink: secureStoreValues.has(`encryption.deviceLink.user-a.${deviceId}`),
    activeFlag: storageValues.has(`encryption.device.active.${deviceId}`),
    revokeToken: secureStoreValues.has("sessionTokenToRevokeOnNextLogin"),
    compatibility: storageValues.has("api_compatibility"),
    accountStorage: accountStorageKeys.filter((key) => storageValues.has(key)),
    otherAccountStorage: otherAccountStorageKeys.every((key) => storageValues.has(key)),
    lostSession: JSON.parse(String(storageValues.get("session.lost") ?? "[]")).map(
      ({ userId }: { userId: string }) => userId,
    ),
  });

  const keptKeys = {
    accountStorage: accountStorageKeys,
    deviceKey: true,
    historyKeys: true,
    savedDeviceLink: true,
    activeFlag: true,
    lostSession: ["user-a"],
  };
  const wipedKeys = {
    accountStorage: [],
    deviceKey: false,
    historyKeys: false,
    savedDeviceLink: false,
    activeFlag: false,
    lostSession: [],
  };

  test.each([
    [
      "signedOut",
      {
        signedOut: true,
        queuedPoints: true,
        pendingSharingChanges: false,
        revokeToken: true,
        compatibility: true,
        ...keptKeys,
        lostSession: [],
      },
    ],
    [
      "phoneRemoved",
      {
        signedOut: true,
        queuedPoints: false,
        pendingSharingChanges: false,
        revokeToken: true,
        compatibility: true,
        ...wipedKeys,
      },
    ],
    [
      "accountDeleted",
      {
        signedOut: true,
        queuedPoints: false,
        pendingSharingChanges: false,
        revokeToken: true,
        compatibility: true,
        ...wipedKeys,
      },
    ],
    [
      "serverChanged",
      {
        signedOut: true,
        queuedPoints: false,
        pendingSharingChanges: false,
        revokeToken: false,
        compatibility: false,
        ...keptKeys,
      },
    ],
    [
      "sessionLost",
      {
        signedOut: false,
        queuedPoints: true,
        pendingSharingChanges: true,
        revokeToken: true,
        compatibility: true,
        ...keptKeys,
      },
    ],
  ] as const)("%s clears exactly what its row says", async (reason, expected) => {
    const device = await seedSignedInPhone();

    await endSession({ reason });

    expect(observe(device.deviceId)).toEqual({
      trackingRevoked: true,
      pushTokenForgotten: true,
      registration: false,
      pendingJoinCodes: false,
      otherAccountStorage: true,
      ...expected,
    });
  });

  test.each([
    ["signedOut", false],
    ["phoneRemoved", false],
    ["accountDeleted", false],
    ["serverChanged", false],
    ["sessionLost", true],
  ] as const)("%s leaves this phone's own picture key: %p", async (reason, kept) => {
    await seedSignedInPhone();
    secureStoreValues.set("encryption.profileImage.user-a", "picture-key");

    await endSession({ reason });

    expect(secureStoreValues.has("encryption.profileImage.user-a")).toBe(kept);
  });

  test.each([
    "signedOut",
    "phoneRemoved",
    "accountDeleted",
    "serverChanged",
    "sessionLost",
  ] as const)(
    "%s deletes every decrypted picture, history export and recovery phrase PDF on this phone",
    async (reason) => {
      await seedSignedInPhone();
      cachedFiles.add("cache/images/0d6c8c2e-2b1a-4c55-9a4e-6f1b2f3c4d5e");
      cachedFiles.add("cache/images/7f0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b");
      cachedFiles.add("cache/history-export/openbeacon-history-2026-11-19.gpx");
      cachedFiles.add("cache/recovery-phrase/openbeacon-recovery-phrase_a1b2.pdf");
      cachedFiles.add("cache/Print/0d6c8c2e-2b1a-4c55-9a4e-6f1b2f3c4d5e.pdf");
      cachedFiles.add("cache/map/tiles.pmtiles");

      await endSession({ reason });

      expect([...cachedFiles]).toEqual(["cache/map/tiles.pmtiles"]);
    },
  );

  test.each([
    ["signedOut", true],
    ["phoneRemoved", false],
    ["accountDeleted", false],
    ["serverChanged", true],
    ["sessionLost", true],
  ] as const)(
    "%s clears alerts once the registration is gone, keeping security alerts: %p",
    async (reason, keepSecurityAlerts) => {
      await seedSignedInPhone();
      eventNoticeClears = [];

      await endSession({ reason });

      expect(eventNoticeClears).toEqual([{ keepSecurityAlerts }]);
      expect(registeredAtEventNoticeClears).toEqual([false]);
    },
  );

  test("a round started before sign-out stays refused when the same account signs back in", async () => {
    const { isRoundCurrent, startAccountRound } = await import("./accountSession.ts");
    await seedSignedInPhone();
    const before = startAccountRound("user-a");

    await endSession({ reason: "signedOut" });
    await seedSignedInPhone();

    expect(isRoundCurrent(before)).toBe(false);
    expect(isRoundCurrent(startAccountRound("user-a"))).toBe(true);
  });

  test("a lost session without a registration keeps alerts, since nobody was signed out", async () => {
    await seedSignedOutPhone();
    eventNoticeClears = [];

    await endSession({ reason: "sessionLost" });

    expect(eventNoticeClears).toEqual([]);
  });

  test.each([
    "signedOut",
    "phoneRemoved",
    "accountDeleted",
    "serverChanged",
    "sessionLost",
  ] as const)("%s cancels a history export that's running", async (reason) => {
    await seedSignedInPhone();
    const running = startHistoryExport();

    await endSession({ reason });

    expect(running?.signal.aborted).toBe(true);
    const next = startHistoryExport();
    expect(next).not.toBeNull();
    if (next) finishHistoryExport(next);
  });

  test("a plain sign-out stops the picture key check", async () => {
    await seedSignedInPhone();
    const before = imageKeyCheckResets;

    await endSession({ reason: "signedOut" });

    expect(imageKeyCheckResets).toBe(before + 1);
  });

  test("deletes decrypted pictures before contacting the server", async () => {
    await seedSignedInPhone();
    cachedFiles.add("cache/images/0d6c8c2e-2b1a-4c55-9a4e-6f1b2f3c4d5e");

    await endSession({ reason: "signedOut" });

    expect(picturesAtSignOut).toBe(0);
  });

  test("a lost session's picture key is wiped along with its other keys", async () => {
    await seedSignedInPhone();
    secureStoreValues.set("encryption.profileImage.user-a", "picture-key");
    await endSession({ reason: "sessionLost" });

    await settleLostSessions({ userId: "user-b" });

    expect(secureStoreValues.has("encryption.profileImage.user-a")).toBe(false);
  });

  test("a sign-out keeps queued points that no pause is holding back", async () => {
    await seedSignedInPhone();

    await endSession({ reason: "signedOut" });

    expect(queueDeletions).toEqual([]);
  });

  test("a normal sign-out keeps the account's keys when another account signs in or 30 days pass", async () => {
    const device = await seedSignedInPhone();
    await endSession({ reason: "signedOut" });

    await settleLostSessions({ userId: "user-b" });
    await settleLostSessions({ userId: null, now: Date.now() + 31 * 24 * 60 * 60_000 });

    expect(observe(device.deviceId)).toMatchObject({ ...keptKeys, lostSession: [] });
    expect(queueDeletions).toEqual([]);
  });

  test("the same account signing in again keeps its keys and forgets the lost session", async () => {
    const device = await seedSignedInPhone();
    await endSession({ reason: "sessionLost" });

    await settleLostSessions({ userId: "user-a" });

    expect(storageValues.has("session.lost")).toBe(false);
    expect(observe(device.deviceId)).toMatchObject({ deviceKey: true, historyKeys: true });
  });

  test("a different account signing in wipes the lost account's keys and queued points", async () => {
    const device = await seedSignedInPhone();
    await endSession({ reason: "sessionLost" });

    await settleLostSessions({ userId: "user-b" });

    expect(observe(device.deviceId)).toMatchObject({
      ...wipedKeys,
      pendingSharingChanges: false,
    });
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
  });

  test("a lost account's keys are wiped after 30 days with no sign-in, not before", async () => {
    const device = await seedSignedInPhone();
    await endSession({ reason: "sessionLost" });
    const day = 24 * 60 * 60_000;

    await settleLostSessions({ userId: null, now: Date.now() + 29 * day });
    expect(observe(device.deviceId)).toMatchObject(keptKeys);

    await settleLostSessions({ userId: null, now: Date.now() + 31 * day });
    expect(observe(device.deviceId)).toMatchObject(wipedKeys);
  });
});
