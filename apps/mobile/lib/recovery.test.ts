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
  HistoryPrivateKeyMaterial,
  openHistoryKeyEscrow,
  RecoveryPhrase,
  RecoveryPrivateKeyMaterial,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";
import { setupAccountRecoverySchema } from "@openbeacon/schemas";
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
let serverHistoryKey: { id: string; publicKey: string; version: number } | null = null;
let setupError: Error | null = null;
let failNextStore = false;
let failAddHistoryWrapsCall: number | null = null;
let serverClaimedUserId = device.userId;
let addHistoryWrapsCalls = 0;
const serverInputs: unknown[] = [];
const storedHistoryKeys = new Map<string, HistoryPrivateKeyMaterial>();

const setupMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  if (setupError) throw setupError;
  const parsed = setupAccountRecoverySchema.parse(input);
  serverHistoryKey = {
    id: parsed.historyKey.id,
    publicKey: parsed.historyKey.publicKey,
    version: parsed.historyKey.version,
  };
  return { historyKeyVersion: parsed.historyKey.version };
});

const listHistoryBackfillMock = mock(
  async (input: { cursor?: number | null; deviceId: string; groupId: string }) => {
    serverInputs.push(input);
    const historyKey = serverHistoryKey;
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
      historyKey: { ...historyKey, userId: serverClaimedUserId },
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
    accountRecovery: { setup: { mutate: setupMock } },
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
}));

const {
  backfillHistoryWraps,
  confirmsRecoveryPhrase,
  pickConfirmationIndexes,
  setUpRecoveryPhrase,
} = await import("./recovery.ts");
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
  serverHistoryKey = null;
  setupError = null;
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

describe("setUpRecoveryPhrase", () => {
  test("registers a valid escrow and stores history key v1", async () => {
    const phrase = generateRecoveryPhrase();

    const result = await setUpRecoveryPhrase(phrase);

    expect(result.status).toBe("created");
    const input = setupAccountRecoverySchema.parse(setupMock.mock.calls[0]?.[0]);
    const recoveryKey = deriveRecoveryKeyPair(phrase);
    expect(input.recoveryKey.publicKey).toBe(recoveryKey.publicKey);
    expect(input.historyKey.version).toBe(1);
    const opened = openHistoryKeyEscrow({
      escrow: input.historyKey.escrow,
      historyKey: { publicKey: input.historyKey.publicKey, userId: device.userId, version: 1 },
      recoveryPrivateKey: recoveryKey.privateKey,
    });
    const stored = storedHistoryKeys.get(`${device.userId}.1`);
    expect(stored).toBeDefined();
    expect(encodeBase64((stored as HistoryPrivateKeyMaterial).expose())).toBe(
      encodeBase64(opened.expose()),
    );
    expect(getHistoryPublicKey(opened)).toBe(input.historyKey.publicKey);
  });

  test("escrow is bound to the user, so another account's recovery key can't open it", async () => {
    const phrase = generateRecoveryPhrase();
    await setUpRecoveryPhrase(phrase);
    const input = setupAccountRecoverySchema.parse(setupMock.mock.calls[0]?.[0]);

    expect(() =>
      openHistoryKeyEscrow({
        escrow: input.historyKey.escrow,
        historyKey: { publicKey: input.historyKey.publicKey, userId: "user-2", version: 1 },
        recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
      }),
    ).toThrow();
  });

  test("CONFLICT sends the user to restore and stores nothing", async () => {
    setupError = conflictError();

    const result = await setUpRecoveryPhrase(generateRecoveryPhrase());

    expect(result).toEqual({ status: "conflict" });
    expect(storedHistoryKeys.size).toBe(0);
  });

  test("FORBIDDEN asks for a fresh sign-in and stores nothing", async () => {
    setupError = TRPCClientError.from({
      error: { code: -32003, data: { code: "FORBIDDEN" }, message: "Sign in again to continue." },
    });

    const result = await setUpRecoveryPhrase(generateRecoveryPhrase());

    expect(result).toEqual({ status: "reauthenticate" });
    expect(storedHistoryKeys.size).toBe(0);
  });

  test("a phone that can't save the key reports unsaved after the server setup succeeded", async () => {
    failNextStore = true;

    const result = await setUpRecoveryPhrase(generateRecoveryPhrase());

    expect(result.status).toBe("unsaved");
    expect(setupMock).toHaveBeenCalledTimes(1);
    expect(serverHistoryKey?.version).toBe(1);
    expect(storedHistoryKeys.size).toBe(0);
  });

  test("other errors are thrown and store nothing", async () => {
    setupError = new Error("Network error");

    await expect(setUpRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow("Network error");
    expect(storedHistoryKeys.size).toBe(0);
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

  test("does nothing before a phrase is set up", async () => {
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
    serverHistoryKey = {
      ...(serverHistoryKey as { id: string; publicKey: string; version: number }),
      publicKey: createHistoryKeyPair().publicKey,
    };

    await expect(backfillHistoryWraps({ device, groupId: "group-1" })).rejects.toThrow();
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
  });

  test("uploads nothing and doesn't fail when the current history key was set up elsewhere", async () => {
    epochs = [createServerEpoch(1), createServerEpoch(2)];
    const otherKeys = createHistoryKeyPair();
    serverHistoryKey = { id: "history-key-elsewhere", publicKey: otherKeys.publicKey, version: 1 };

    expect(await backfillHistoryWraps({ device, groupId: "group-1" })).toBe(0);
    expect(addHistoryWrapsMock).not.toHaveBeenCalled();
    expect(epochs.every((epoch) => epoch.historyWraps.size === 0)).toBe(true);
  });

  test("uploads nothing when this phone only holds an older version than the current one", async () => {
    epochs = [createServerEpoch(1)];
    await setUpRecoveryPhrase(generateRecoveryPhrase());
    const resetElsewhere = createHistoryKeyPair();
    serverHistoryKey = { id: "history-key-v2", publicKey: resetElsewhere.publicKey, version: 2 };

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
    for (const secret of secrets) {
      expect(serialized).not.toContain(encodeBase64(secret));
      expect(serialized).not.toContain(Buffer.from(secret).toString("base64url"));
      expect(serialized).not.toContain(Buffer.from(secret).toString("hex"));
      expect(serialized).not.toContain(JSON.stringify(Array.from(secret)).slice(1, -1));
    }
    expect(serialized).not.toContain(phrase.words().join(" "));
    for (const word of phrase.words()) {
      expect(serialized).not.toMatch(
        new RegExp(`(?<![A-Za-z0-9+/_-])${word}(?![A-Za-z0-9+/=_-]|":)`),
      );
    }
    expect(serialized).not.toContain("REDACTED");
    expect(addHistoryWrapsMock).toHaveBeenCalled();
  });

  test("the redacting classes never serialise their bytes", () => {
    const phrase = generateRecoveryPhrase();
    const values = [
      [phrase, "recovery phrase"],
      [new RecoveryPhrase(phrase.expose()), "recovery phrase"],
      [new RecoveryPrivateKeyMaterial(new Uint8Array(32).fill(7)), "recovery private key"],
      [new HistoryPrivateKeyMaterial(new Uint8Array(32).fill(7)), "history private key"],
    ] as const;
    for (const [value, label] of values) {
      expect(JSON.stringify({ value })).toBe(`{"value":"[REDACTED ${label}]"}`);
      expect(String(value)).toBe(`[REDACTED ${label}]`);
    }
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
