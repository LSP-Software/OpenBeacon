import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  deriveRecoveryKeyPair,
  encodeBase64,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  generateRecoveryPhrase,
  getHistoryPublicKey,
  type HistoryKeyEscrow,
  type HistoryPrivateKeyMaterial,
  openHistoryKeyEscrow,
  type RecoveryPhrase,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";
import { expectNoSecretsIn } from "../test/secretLeaks.testUtil.ts";
import {
  createAccountHistoryKeySchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
} from "@openbeacon/schemas";
import { TRPCClientError } from "@trpc/client";

const deviceKeyPair = createDeviceKeyPair();
const device = { deviceId: "device-1", privateKey: deviceKeyPair.privateKey, userId: "user-1" };

type ServerEpoch = {
  createdAt: Date;
  deviceWrap: WrappedEpochKey | null;
  epochId: string;
  epochKey: EpochKeyMaterial;
  epochNumber: number;
  historyWraps: Map<string, WrappedHistoryEpochKey>;
};

let epochs: ServerEpoch[] = [];
type ServerHistoryKey = {
  escrow: HistoryKeyEscrow | null;
  id: string;
  publicKey: string;
  version: number;
};

let serverHistoryKeys: ServerHistoryKey[] = [];
let serverRecoveryKey: ReturnType<typeof setupAccountRecoverySchema.parse>["recoveryKey"] | null =
  null;
let setupError: Error | null = null;
let loseSetupResponse = false;
let createError: Error | null = null;
let loseCreateResponse = false;
let beforeCreate: (() => void) | null = null;
let loseResetResponse = false;
const validResetTokens = new Set<string>();
let failNextStore = false;
let failAddHistoryWrapsCall: number | null = null;
let serverClaimedUserId = device.userId;
let addHistoryWrapsCalls = 0;
const serverInputs: unknown[] = [];
const storedHistoryKeys = new Map<string, HistoryPrivateKeyMaterial>();

const currentServerHistoryKey = () => serverHistoryKeys.at(-1) ?? null;

const createMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  beforeCreate?.();
  if (createError) throw createError;
  const parsed = createAccountHistoryKeySchema.parse(input);
  if (serverHistoryKeys.length > 0) throw conflictError();
  serverHistoryKeys = [{ escrow: null, id: parsed.id, publicKey: parsed.publicKey, version: 1 }];
  if (loseCreateResponse) throw new Error("Network request failed");
  return { historyKeyVersion: 1 };
});

const setupMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  if (setupError) throw setupError;
  const parsed = setupAccountRecoverySchema.parse(input);
  const escrowVersions = parsed.escrows.map(({ version }) => version).sort((a, b) => a - b);
  if (
    serverRecoveryKey ||
    escrowVersions.join() !== serverHistoryKeys.map(({ version }) => version).join()
  ) {
    throw conflictError();
  }
  serverRecoveryKey = parsed.recoveryKey;
  for (const { version, ...escrow } of parsed.escrows) {
    const row = serverHistoryKeys.find((historyKey) => historyKey.version === version);
    if (row) row.escrow = escrow;
  }
  if (loseSetupResponse) throw new Error("Network request failed");
  return { historyKeyVersions: escrowVersions };
});

const resetMock = mock(async (input: unknown) => {
  const parsed = resetAccountRecoverySchema.parse(input);
  if (!parsed.resetToken || !validResetTokens.delete(parsed.resetToken)) {
    throw TRPCClientError.from({
      error: {
        code: -32012,
        data: { code: "PRECONDITION_FAILED" },
        message: "Your email confirmation has expired. Confirm a new code.",
      },
    });
  }
  serverRecoveryKey = parsed.recoveryKey;
  serverHistoryKeys = [parsed.historyKey];
  if (loseResetResponse) throw new Error("Network request failed");
  return { historyKeyVersion: parsed.historyKey.version };
});

const listHistoryBackfillMock = mock(
  async (input: { cursor?: number | null; deviceId: string; groupId: string }) => {
    serverInputs.push(input);
    const historyKey = currentServerHistoryKey();
    if (!historyKey) return { epochs: [], historyKey: null, nextCursor: null };
    const matching = epochs.filter(
      (epoch) =>
        epoch.deviceWrap &&
        epoch.epochNumber > (input.cursor ?? 0) &&
        !epoch.historyWraps.has(historyKey.id),
    );
    const page = matching.slice(0, 50);
    return {
      epochs: page.map(({ deviceWrap, epochId, epochNumber }) => ({
        deviceWrap: deviceWrap as WrappedEpochKey,
        epochId,
        epochNumber,
      })),
      historyKey: {
        id: historyKey.id,
        publicKey: historyKey.publicKey,
        userId: serverClaimedUserId,
        version: historyKey.version,
      },
      nextCursor: matching.length > 50 ? (page.at(-1)?.epochNumber ?? null) : null,
    };
  },
);

const addHistoryWrapsMock = mock(
  async (input: {
    deviceId: string;
    groupId: string;
    historyKeyId: string;
    wraps: WrappedHistoryEpochKey[];
  }) => {
    serverInputs.push(input);
    addHistoryWrapsCalls += 1;
    if (addHistoryWrapsCalls === failAddHistoryWrapsCall) throw new Error("Network error");
    expect(input.wraps.length).toBeLessThanOrEqual(50);
    for (const wrap of input.wraps) {
      const epoch = epochs.find(({ epochId }) => epochId === wrap.epochId);
      if (epoch && !epoch.historyWraps.has(input.historyKeyId)) {
        epoch.historyWraps.set(input.historyKeyId, wrap);
      }
    }
    return { added: input.wraps.length };
  },
);

mock.module("./api.ts", () => ({
  trpcClient: {
    accountHistory: { create: { mutate: createMock } },
    accountRecovery: {
      escrows: {
        query: async () =>
          serverHistoryKeys.flatMap(({ escrow, ...row }) =>
            escrow ? [{ ...row, escrow, userId: device.userId }] : [],
          ),
      },
      reset: { mutate: resetMock },
      setup: { mutate: setupMock },
      status: {
        query: async () => {
          const current = currentServerHistoryKey();
          return {
            currentHistoryKey: current && {
              id: current.id,
              publicKey: current.publicKey,
              version: current.version,
            },
            historyKeys: serverHistoryKeys.map(({ publicKey, version }) => ({
              publicKey,
              version,
            })),
            historyKeyVersions: serverHistoryKeys.map(({ version }) => version),
            recoveryKey: serverRecoveryKey,
            sessionFresh: true,
          };
        },
      },
    },
    groupEpoch: {
      addHistoryWraps: { mutate: addHistoryWrapsMock },
      listHistoryBackfill: { query: listHistoryBackfillMock },
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({
    ...device,
    algorithm: DEVICE_KEY_ALGORITHM,
    publicKey: deviceKeyPair.publicKey,
  }),
}));

const storageValues = new Map<string, string>();
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async ({ userId, version }: { userId: string; version: number }) =>
    storedHistoryKeys.get(`${userId}.${version}`) ?? null,
  storeHistoryKey: async ({
    privateKey,
    userId,
    version,
  }: {
    privateKey: HistoryPrivateKeyMaterial;
    userId: string;
    version: number;
  }) => {
    if (failNextStore) throw new Error("SecureStore unavailable");
    storedHistoryKeys.set(`${userId}.${version}`, privateKey);
  },
  deleteStoredHistoryKeys: async ({
    userId,
    upToVersion,
  }: {
    userId: string;
    upToVersion: number;
  }) => {
    for (let version = 1; version <= upToVersion; version += 1) {
      storedHistoryKeys.delete(`${userId}.${version}`);
    }
  },
}));

const {
  backfillHistoryWraps,
  confirmsRecoveryPhrase,
  HISTORY_KEY_ON_OTHER_DEVICE_MESSAGE,
  pickConfirmationIndexes,
  resetRecoveryPhrase,
  setUpRecoveryPhrase,
  SETUP_KEYS_MISMATCH_MESSAGE,
} = await import("./recovery.ts");
const { createHistoryKey, createHistoryKeyIfMissing, KEY_NOT_SAVED_MESSAGE } =
  await import("./createHistoryKey.ts");
const { unwrapEpochKeyFromWraps } = await import("./epochKeys.ts");
const { checkGroupKeyAccess } = await import("./groupKeyAccess.ts");

const createServerEpoch = (epochNumber: number, heldByDevice = true): ServerEpoch => {
  const epochId = `epoch-${epochNumber}`;
  const epochKey = generateGroupEpochKey();
  return {
    createdAt: new Date(Date.UTC(2026, 0, epochNumber)),
    deviceWrap: heldByDevice
      ? wrapEpochKeyForRecipient({
          epoch: {
            createdAt: new Date(0),
            createdByDeviceId: device.deviceId,
            epochId,
            epochNumber,
            groupId: "group-1",
          },
          epochKey,
          recipient: {
            algorithm: DEVICE_KEY_ALGORITHM,
            createdAt: new Date(0),
            deviceId: device.deviceId,
            publicKey: deviceKeyPair.publicKey,
            revokedAt: null,
            userId: device.userId,
          },
          senderPrivateKey: deviceKeyPair.privateKey,
        })
      : null,
    epochId,
    epochKey,
    epochNumber,
    historyWraps: new Map(),
  };
};

const resolveThroughHistoryWrapOnly = (epoch: ServerEpoch) =>
  unwrapEpochKeyFromWraps({
    device,
    epochId: epoch.epochId,
    getHistoryKey: async (version) => storedHistoryKeys.get(`${device.userId}.${version}`) ?? null,
    wraps: {
      deviceWrap: null,
      historyWraps: [...epoch.historyWraps.values()].map((wrap) => ({
        ...wrap,
        createdAt: new Date(0),
      })),
    },
  });

const conflictError = () =>
  TRPCClientError.from({
    error: { code: -32009, data: { code: "CONFLICT" }, message: "Already set up" },
  });

beforeEach(() => {
  epochs = [];
  serverHistoryKeys = [];
  serverRecoveryKey = null;
  setupError = null;
  loseSetupResponse = false;
  createError = null;
  loseCreateResponse = false;
  beforeCreate = null;
  createMock.mockClear();
  loseResetResponse = false;
  validResetTokens.clear();
  resetMock.mockClear();
  failNextStore = false;
  failAddHistoryWrapsCall = null;
  serverClaimedUserId = device.userId;
  addHistoryWrapsCalls = 0;
  serverInputs.length = 0;
  storedHistoryKeys.clear();
  setupMock.mockClear();
  listHistoryBackfillMock.mockClear();
  addHistoryWrapsMock.mockClear();
});

const openSetupEscrow = (phrase: RecoveryPhrase, version: number) => {
  const input = setupAccountRecoverySchema.parse(setupMock.mock.calls.at(-1)?.[0]);
  const escrow = input.escrows.find((candidate) => candidate.version === version);
  const historyKey = serverHistoryKeys.find((candidate) => candidate.version === version);
  if (!escrow || !historyKey) throw new Error(`No escrow for v${version}`);
  return openHistoryKeyEscrow({
    escrow: { algorithm: escrow.algorithm, ciphertext: escrow.ciphertext, enc: escrow.enc },
    historyKey: { publicKey: historyKey.publicKey, userId: device.userId, version },
    recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
  });
};

const storedKey = (version: number) => {
  const stored = storedHistoryKeys.get(`${device.userId}.${version}`);
  if (!stored) throw new Error(`No stored key for v${version}`);
  return encodeBase64(stored.expose());
};

const holdServerHistoryKey = (version: number) => {
  const historyKey = createHistoryKeyPair();
  serverHistoryKeys.push({
    escrow: null,
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
    version,
  });
  storedHistoryKeys.set(`${device.userId}.${version}`, historyKey.privateKey);
};

describe("createHistoryKey", () => {
  test("creates v1 with no escrow once and stores its private key", async () => {
    expect(await createHistoryKeyIfMissing(device.userId)).toBe(true);
    expect(await createHistoryKeyIfMissing(device.userId)).toBe(false);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(serverHistoryKeys).toMatchObject([{ escrow: null, version: 1 }]);
    const stored = storedHistoryKeys.get(`${device.userId}.1`);
    expect(stored && getHistoryPublicKey(stored)).toBe(serverHistoryKeys[0]?.publicKey);
  });

  test("a phone that loses the race keeps nothing and reports that it doesn't hold the key", async () => {
    const winner = createHistoryKeyPair();
    beforeCreate = () => {
      serverHistoryKeys = [{ escrow: null, id: "winner", publicKey: winner.publicKey, version: 1 }];
    };

    expect(await createHistoryKey(device.userId)).toBe(false);

    expect(serverHistoryKeys).toMatchObject([{ id: "winner", publicKey: winner.publicKey }]);
    expect(storedHistoryKeys.size).toBe(0);
  });

  test("a lost response for a create that went through keeps the key", async () => {
    loseCreateResponse = true;

    expect(await createHistoryKey(device.userId)).toBe(true);

    const stored = storedHistoryKeys.get(`${device.userId}.1`);
    expect(stored && getHistoryPublicKey(stored)).toBe(serverHistoryKeys[0]?.publicKey);
  });

  test("a create that fails before reaching the server throws and keeps nothing", async () => {
    createError = new Error("Network error");

    await expect(createHistoryKey(device.userId)).rejects.toThrow("Network error");

    expect(serverHistoryKeys).toEqual([]);
    expect(storedHistoryKeys.size).toBe(0);
  });

  test("a phone that can't save the key never sends it to the server", async () => {
    failNextStore = true;

    await expect(createHistoryKey(device.userId)).rejects.toThrow(KEY_NOT_SAVED_MESSAGE);

    expect(createMock).not.toHaveBeenCalled();
    expect(serverHistoryKeys).toEqual([]);
  });
});

describe("setUpRecoveryPhrase", () => {
  test("on an account with no history key, creates v1 and escrows it", async () => {
    const phrase = generateRecoveryPhrase();

    const result = await setUpRecoveryPhrase(phrase);

    expect(result.status).toBe("created");
    expect(createMock).toHaveBeenCalledTimes(1);
    const input = setupAccountRecoverySchema.parse(setupMock.mock.calls[0]?.[0]);
    expect(input.recoveryKey.publicKey).toBe(deriveRecoveryKeyPair(phrase).publicKey);
    expect(input.escrows.map(({ version }) => version)).toEqual([1]);
    expect(encodeBase64(openSetupEscrow(phrase, 1).expose())).toBe(storedKey(1));
  });

  test("escrows every version the account already has without creating one", async () => {
    holdServerHistoryKey(1);
    holdServerHistoryKey(2);
    const phrase = generateRecoveryPhrase();

    expect((await setUpRecoveryPhrase(phrase)).status).toBe("created");

    expect(createMock).not.toHaveBeenCalled();
    for (const version of [1, 2]) {
      expect(encodeBase64(openSetupEscrow(phrase, version).expose())).toBe(storedKey(version));
    }
    expect(serverHistoryKeys.every(({ escrow }) => escrow !== null)).toBe(true);
  });

  test("a phone without the account's history key sets up nothing", async () => {
    holdServerHistoryKey(1);
    storedHistoryKeys.clear();

    await expect(setUpRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      HISTORY_KEY_ON_OTHER_DEVICE_MESSAGE,
    );

    expect(setupMock).not.toHaveBeenCalled();
    expect(serverRecoveryKey).toBeNull();
  });

  test("a stored key that doesn't match the account's is never escrowed", async () => {
    holdServerHistoryKey(1);
    storedHistoryKeys.set(`${device.userId}.1`, createHistoryKeyPair().privateKey);

    await expect(setUpRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      SETUP_KEYS_MISMATCH_MESSAGE,
    );

    expect(setupMock).not.toHaveBeenCalled();
  });

  test("escrow is bound to the user, so another account's recovery key can't open it", async () => {
    const phrase = generateRecoveryPhrase();
    await setUpRecoveryPhrase(phrase);
    const input = setupAccountRecoverySchema.parse(setupMock.mock.calls[0]?.[0]);
    const escrow = input.escrows[0] as HistoryKeyEscrow & { version: number };

    expect(() =>
      openHistoryKeyEscrow({
        escrow: { algorithm: escrow.algorithm, ciphertext: escrow.ciphertext, enc: escrow.enc },
        historyKey: {
          publicKey: serverHistoryKeys[0]?.publicKey ?? "",
          userId: "user-2",
          version: 1,
        },
        recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
      }),
    ).toThrow();
  });

  test("a phrase set up on another phone reports conflict", async () => {
    await setUpRecoveryPhrase(generateRecoveryPhrase());

    const result = await setUpRecoveryPhrase(generateRecoveryPhrase());

    expect(result).toEqual({ status: "conflict" });
    expect(setupMock).toHaveBeenCalledTimes(1);
  });

  test("a CONFLICT after this phone's setup response was lost finishes with the same phrase", async () => {
    const phrase = generateRecoveryPhrase();
    loseSetupResponse = true;
    await expect(setUpRecoveryPhrase(phrase)).rejects.toThrow("Network request failed");
    loseSetupResponse = false;
    const created = storedKey(1);

    const result = await setUpRecoveryPhrase(phrase);

    expect(result.status).toBe("created");
    expect(setupMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(encodeBase64(openSetupEscrow(phrase, 1).expose())).toBe(created);
    expect(storedKey(1)).toBe(created);
  });

  test("FORBIDDEN asks for a fresh sign-in and sets up no phrase", async () => {
    setupError = TRPCClientError.from({
      error: { code: -32003, data: { code: "FORBIDDEN" }, message: "Sign in again to continue." },
    });

    const result = await setUpRecoveryPhrase(generateRecoveryPhrase());

    expect(result).toEqual({ status: "reauthenticate" });
    expect(serverRecoveryKey).toBeNull();
    expect(serverHistoryKeys.every(({ escrow }) => escrow === null)).toBe(true);
  });

  test("other errors are thrown and set up no phrase", async () => {
    setupError = new Error("Network error");

    await expect(setUpRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow("Network error");
    expect(serverRecoveryKey).toBeNull();
  });
});

describe("resetRecoveryPhrase", () => {
  test("a retry after the reset response was lost finishes with the phrase that was set", async () => {
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    const phrase = generateRecoveryPhrase();
    validResetTokens.add("reset-token");
    loseResetResponse = true;
    await expect(resetRecoveryPhrase(phrase, "reset-token")).rejects.toThrow(
      "Network request failed",
    );
    loseResetResponse = false;

    const result = await resetRecoveryPhrase(phrase, "reset-token");

    expect(result.status).toBe("reset");
    expect(resetMock).toHaveBeenCalledTimes(1);
    const committed = resetAccountRecoverySchema.parse(resetMock.mock.calls[0]?.[0]);
    const opened = openHistoryKeyEscrow({
      escrow: committed.historyKey.escrow,
      historyKey: {
        publicKey: committed.historyKey.publicKey,
        userId: device.userId,
        version: 2,
      },
      recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
    });
    const stored = storedHistoryKeys.get(`${device.userId}.2`);
    expect(stored).toBeDefined();
    expect(encodeBase64((stored as HistoryPrivateKeyMaterial).expose())).toBe(
      encodeBase64(opened.expose()),
    );
  });

  test("a spent or expired confirmation asks for a new code and changes nothing", async () => {
    const original = generateRecoveryPhrase();
    await setUpRecoveryPhrase(original);

    const result = await resetRecoveryPhrase(generateRecoveryPhrase(), "spent-token");

    expect(result).toEqual({ status: "confirmationExpired" });
    expect(serverRecoveryKey?.publicKey).toBe(deriveRecoveryKeyPair(original).publicKey);
    expect(storedHistoryKeys.has(`${device.userId}.2`)).toBe(false);
  });
});

describe("backfillHistoryWraps", () => {
  test("pages through every held epoch so each resolves through a history wrap alone", async () => {
    epochs = Array.from({ length: 123 }, (_, index) => createServerEpoch(index + 1));
    await setUpRecoveryPhrase(generateRecoveryPhrase());

    const wrapped = await backfillHistoryWraps({ device, groupId: "group-1" });

    expect(wrapped).toBe(123);
    expect(listHistoryBackfillMock.mock.calls.map(([input]) => input.cursor)).toEqual([
      null,
      50,
      100,
    ]);
    expect(addHistoryWrapsMock.mock.calls.map(([input]) => input.wraps.length)).toEqual([
      50, 50, 23,
    ]);
    for (const epoch of epochs) {
      const epochKey = await resolveThroughHistoryWrapOnly(epoch);
      expect(epochKey && encodeBase64(epochKey.expose())).toBe(
        encodeBase64(epoch.epochKey.expose()),
      );
    }
  });

  test("costs one query when nothing is missing", async () => {
    epochs = [createServerEpoch(1)];
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    await backfillHistoryWraps({ device, groupId: "group-1" });
    listHistoryBackfillMock.mockClear();
    addHistoryWrapsMock.mockClear();

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(0);
    expect(listHistoryBackfillMock).toHaveBeenCalledTimes(1);
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
  });

  test("fills every wrap once an account without a phrase gets its history key", async () => {
    epochs = Array.from({ length: 3 }, (_, index) => createServerEpoch(index + 1));
    await createHistoryKeyIfMissing(device.userId);

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(3);

    expect(serverRecoveryKey).toBeNull();
    for (const epoch of epochs) {
      const epochKey = await resolveThroughHistoryWrapOnly(epoch);
      expect(epochKey && encodeBase64(epochKey.expose())).toBe(
        encodeBase64(epoch.epochKey.expose()),
      );
    }
  });

  test("does nothing before the account has a history key", async () => {
    epochs = [createServerEpoch(1)];

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(0);
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
  });

  test("finishes on the next run after a partial failure without re-uploading", async () => {
    epochs = Array.from({ length: 120 }, (_, index) => createServerEpoch(index + 1));
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    failAddHistoryWrapsCall = 2;

    await expect(backfillHistoryWraps({ device, groupId: "group-1" })).rejects.toThrow(
      "Network error",
    );
    expect(epochs.filter((epoch) => epoch.historyWraps.size > 0)).toHaveLength(50);

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(70);
    const uploaded = addHistoryWrapsMock.mock.calls
      .slice(2)
      .flatMap(([input]) => input.wraps.map(({ epochId }) => epochId));
    expect(new Set(uploaded).size).toBe(70);
    expect(uploaded.some((epochId) => epochs.slice(0, 50).some((e) => e.epochId === epochId))).toBe(
      false,
    );
    for (const epoch of epochs) {
      expect(epoch.historyWraps.size).toBe(1);
      expect(await resolveThroughHistoryWrapOnly(epoch)).not.toBeNull();
    }
  });

  test("skips an epoch whose device wrap can't be opened and wraps the rest", async () => {
    const tampered = createServerEpoch(1);
    epochs = [{ ...tampered, deviceWrap: createServerEpoch(9).deviceWrap }, createServerEpoch(2)];
    await setUpRecoveryPhrase(generateRecoveryPhrase());

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(1);
    expect(epochs[0]?.historyWraps.size).toBe(0);
    expect(epochs[1]?.historyWraps.size).toBe(1);
  });

  test("refuses to wrap to a history public key that doesn't match the stored key", async () => {
    epochs = [createServerEpoch(1)];
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    serverHistoryKeys = serverHistoryKeys.map((historyKey) => ({
      ...historyKey,
      publicKey: createHistoryKeyPair().publicKey,
    }));

    await expect(backfillHistoryWraps({ device, groupId: "group-1" })).rejects.toThrow();
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
  });

  test("uploads nothing and doesn't fail when the current history key was set up elsewhere", async () => {
    epochs = [createServerEpoch(1), createServerEpoch(2)];
    const otherKeys = createHistoryKeyPair();
    serverHistoryKeys = [
      { escrow: null, id: "history-key-elsewhere", publicKey: otherKeys.publicKey, version: 1 },
    ];

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(0);
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
    expect(epochs.every((epoch) => epoch.historyWraps.size === 0)).toBe(true);
  });

  test("uploads nothing when this phone only holds an older version than the current one", async () => {
    epochs = [createServerEpoch(1)];
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    const resetElsewhere = createHistoryKeyPair();
    serverHistoryKeys = [
      { escrow: null, id: "history-key-v2", publicKey: resetElsewhere.publicKey, version: 2 },
    ];

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(0);
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
    expect(epochs[0]?.historyWraps.size).toBe(0);
  });

  test("binds wraps to this device's user even if the server names another", async () => {
    epochs = [createServerEpoch(1)];
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    serverClaimedUserId = "user-2";

    await backfillHistoryWraps({ device, groupId: "group-1" });

    expect(addHistoryWrapsMock.mock.calls[0]?.[0].wraps[0]?.userId).toBe(device.userId);
    expect(await resolveThroughHistoryWrapOnly(epochs[0] as ServerEpoch)).not.toBeNull();
  });

  test("a device-only account backfills what it holds and reports the rest as not recoverable", async () => {
    epochs = [
      createServerEpoch(1),
      createServerEpoch(2, false),
      createServerEpoch(3),
      createServerEpoch(4),
      createServerEpoch(5),
    ];
    await setUpRecoveryPhrase(generateRecoveryPhrase());

    await backfillHistoryWraps({ device, groupId: "group-1" });

    for (const epoch of epochs) {
      expect((await resolveThroughHistoryWrapOnly(epoch)) !== null).toBe(epoch.epochNumber !== 2);
    }
    const access = await checkGroupKeyAccess({
      canResolve: async (epoch: ServerEpoch) =>
        (await resolveThroughHistoryWrapOnly(epoch)) !== null,
      listEpochs: async () => ({ epochs: [...epochs].reverse(), nextCursor: null }),
    });
    expect(access).toEqual({
      current: "available",
      history: { partialFrom: new Date(Date.UTC(2026, 0, 3)) },
    });
  });
});

describe("secrets never reach the server", () => {
  test("setup and backfill inputs carry no phrase words or private key bytes", async () => {
    epochs = Array.from({ length: 60 }, (_, index) => createServerEpoch(index + 1));
    const phrase = generateRecoveryPhrase();

    await setUpRecoveryPhrase(phrase);
    await backfillHistoryWraps({ device, groupId: "group-1" });

    const serialized = JSON.stringify(serverInputs);
    const historyPrivateKey = storedHistoryKeys.get(`${device.userId}.1`);
    const secrets = [
      deriveRecoveryKeyPair(phrase).privateKey.expose(),
      (historyPrivateKey as HistoryPrivateKeyMaterial).expose(),
      deviceKeyPair.privateKey.expose(),
      ...epochs.map(({ epochKey }) => epochKey.expose()),
    ];
    expectNoSecretsIn(serialized, { secrets, phrases: [phrase] });
    expect(addHistoryWrapsMock).toHaveBeenCalled();
  });
});

describe("phrase confirmation", () => {
  test("picks three distinct word positions from anywhere in the phrase", () => {
    const counts = Array.from({ length: 12 }, () => 0);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const indexes = pickConfirmationIndexes();
      expect(new Set(indexes).size).toBe(3);
      for (const index of indexes) counts[index] = (counts[index] ?? 0) + 1;
    }
    expect(counts.every((count) => count > 0 && count < 200)).toBe(true);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(600);
  });

  test("accepts the right words, ignoring case and spacing, and rejects a wrong one", () => {
    const phrase = generateRecoveryPhrase();
    const words = phrase.words();
    const answers = [0, 5, 11].map((index) => ({
      index,
      word: ` ${words[index]?.toUpperCase()} `,
    }));

    expect(confirmsRecoveryPhrase({ answers, phrase })).toBe(true);
    expect(
      confirmsRecoveryPhrase({
        answers: [...answers.slice(0, 2), { index: 11, word: `${words[11]}s` }],
        phrase,
      }),
    ).toBe(false);
    expect(confirmsRecoveryPhrase({ answers: [], phrase })).toBe(false);
  });
});
