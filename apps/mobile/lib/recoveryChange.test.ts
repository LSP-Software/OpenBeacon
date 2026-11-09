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
  type HistoryKeyEscrow,
  type HistoryPrivateKeyMaterial,
  openHistoryKeyEscrow,
  type RecoveryPhrase,
  sealHistoryKeyEscrow,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";
import { expectNoSecretsIn } from "../test/secretLeaks.testUtil.ts";
import {
  changeRecoveryPhraseSchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
} from "@openbeacon/schemas";
import { TRPCClientError } from "@trpc/client";

const userId = "user-1";

const createPhone = (deviceId: string) => {
  const keyPair = createDeviceKeyPair();
  return {
    device: { deviceId, privateKey: keyPair.privateKey, userId },
    publicKey: keyPair.publicKey,
    secureStore: new Map<string, HistoryPrivateKeyMaterial>(),
  };
};

type Phone = ReturnType<typeof createPhone>;

type ServerEpoch = {
  createdAt: Date;
  deviceWraps: Map<string, WrappedEpochKey>;
  epochId: string;
  epochKey: EpochKeyMaterial;
  epochNumber: number;
  groupId: string;
  historyWraps: Map<string, WrappedHistoryEpochKey>;
};

type ServerHistoryKey = {
  escrow: HistoryKeyEscrow;
  id: string;
  publicKey: string;
  version: number;
};

let phone: Phone;
let recoveryKey: { algorithm: string; derivationVersion: number; publicKey: string } | null;
let historyKeys: ServerHistoryKey[];
let epochs: ServerEpoch[];
let groupIds: string[];
let sessionFresh: boolean;
let beforeRecoveryWrite: (() => void) | null;
let failingGroupId: string | null;
let failingReadVersion: number | null;
let failNextStore: boolean;
const serverInputs: unknown[] = [];

const trpcError = (code: string, jsonRpcCode: number) =>
  TRPCClientError.from({ error: { code: jsonRpcCode, data: { code }, message: code } });

const currentHistoryKey = () => historyKeys.at(-1) ?? null;

const statusMock = mock(async (input?: unknown) => {
  serverInputs.push(input);
  const current = currentHistoryKey();
  return {
    currentHistoryKey: current && {
      id: current.id,
      publicKey: current.publicKey,
      version: current.version,
    },
    historyKeyVersions: historyKeys.map(({ version }) => version),
    recoveryKey,
  };
});

const escrowsMock = mock(async (input?: unknown) => {
  serverInputs.push(input);
  return historyKeys.map((row) => ({ ...row, userId }));
});

const setupMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  const parsed = setupAccountRecoverySchema.parse(input);
  recoveryKey = parsed.recoveryKey;
  historyKeys = [parsed.historyKey];
  return { historyKeyVersion: parsed.historyKey.version };
});

const changePhraseMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  if (!sessionFresh) throw trpcError("FORBIDDEN", -32003);
  const parsed = changeRecoveryPhraseSchema.parse(input);
  beforeRecoveryWrite?.();
  if (!recoveryKey) throw trpcError("NOT_FOUND", -32004);
  const escrowVersions = parsed.escrows.map(({ version }) => version).sort((a, b) => a - b);
  if (escrowVersions.join() !== historyKeys.map(({ version }) => version).join()) {
    throw trpcError("CONFLICT", -32009);
  }
  recoveryKey = parsed.recoveryKey;
  for (const { version, ...escrow } of parsed.escrows) {
    const row = historyKeys.find((historyKey) => historyKey.version === version);
    if (row) row.escrow = escrow;
  }
  return { historyKeyVersions: escrowVersions };
});

const resetMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  if (!sessionFresh) throw trpcError("FORBIDDEN", -32003);
  const parsed = resetAccountRecoverySchema.parse(input);
  beforeRecoveryWrite?.();
  if (!recoveryKey) throw trpcError("NOT_FOUND", -32004);
  if (parsed.historyKey.version !== (currentHistoryKey()?.version ?? 0) + 1) {
    throw trpcError("CONFLICT", -32009);
  }
  for (const epoch of epochs) {
    for (const { id } of historyKeys) epoch.historyWraps.delete(id);
  }
  recoveryKey = parsed.recoveryKey;
  historyKeys = [parsed.historyKey];
  return { historyKeyVersion: parsed.historyKey.version };
});

const listHistoryBackfillMock = mock(
  async (input: { cursor?: number | null; deviceId: string; groupId: string }) => {
    serverInputs.push(input);
    const current = currentHistoryKey();
    if (!current) return { epochs: [], historyKey: null, nextCursor: null };
    return {
      epochs: epochs
        .filter(
          (epoch) =>
            epoch.groupId === input.groupId &&
            epoch.deviceWraps.has(input.deviceId) &&
            !epoch.historyWraps.has(current.id),
        )
        .map(({ deviceWraps, epochId, epochNumber }) => ({
          deviceWrap: deviceWraps.get(input.deviceId) as WrappedEpochKey,
          epochId,
          epochNumber,
        })),
      historyKey: {
        id: current.id,
        publicKey: current.publicKey,
        userId,
        version: current.version,
      },
      nextCursor: null,
    };
  },
);

const addHistoryWrapsMock = mock(
  async (input: { groupId: string; historyKeyId: string; wraps: WrappedHistoryEpochKey[] }) => {
    serverInputs.push(input);
    if (input.groupId === failingGroupId) throw new Error("Network error");
    if (input.historyKeyId !== currentHistoryKey()?.id) throw trpcError("BAD_REQUEST", -32600);
    for (const wrap of input.wraps) {
      epochs
        .find(({ epochId }) => epochId === wrap.epochId)
        ?.historyWraps.set(input.historyKeyId, wrap);
    }
    return { added: input.wraps.length };
  },
);

const listGroupsMock = mock(async (input?: unknown) => {
  serverInputs.push(input);
  return groupIds.map((id) => ({ id }));
});

mock.module("./api.ts", () => ({
  trpcClient: {
    accountRecovery: {
      changePhrase: { mutate: changePhraseMock },
      escrows: { query: escrowsMock },
      reset: { mutate: resetMock },
      setup: { mutate: setupMock },
      status: { query: statusMock },
    },
    groupEpoch: {
      addHistoryWraps: { mutate: addHistoryWrapsMock },
      listHistoryBackfill: { query: listHistoryBackfillMock },
    },
    groupMembership: { list: { query: listGroupsMock } },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({
    ...phone.device,
    algorithm: DEVICE_KEY_ALGORITHM,
    publicKey: phone.publicKey,
  }),
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async (input: { userId: string; version: number }) => {
    if (input.version === failingReadVersion) throw new Error("SecureStore unavailable");
    return phone.secureStore.get(`${input.userId}.${input.version}`) ?? null;
  },
  storeHistoryKey: async (input: {
    privateKey: HistoryPrivateKeyMaterial;
    userId: string;
    version: number;
  }) => {
    if (failNextStore) {
      failNextStore = false;
      throw new Error("SecureStore unavailable");
    }
    phone.secureStore.set(`${input.userId}.${input.version}`, input.privateKey);
  },
}));

const {
  backfillEveryGroup,
  backfillHistoryWraps,
  changeRecoveryPhrase,
  findMissingHistoryKey,
  HISTORY_KEYS_MISMATCH_MESSAGE,
  MISSING_HISTORY_KEYS_MESSAGE,
  PHRASE_MISMATCH_MESSAGE,
  RECOVERY_CHANGED_MESSAGE,
  resetRecoveryPhrase,
  restoreFromRecoveryPhrase,
  setUpRecoveryPhrase,
} = await import("./recovery.ts");
const { unwrapEpochKeyFromWraps } = await import("./epochKeys.ts");
const { checkGroupKeyAccess } = await import("./groupKeyAccess.ts");

const createEpoch = ({
  epochNumber,
  groupId,
  holders,
}: {
  epochNumber: number;
  groupId: string;
  holders: Phone[];
}) => {
  const epochId = `${groupId}-epoch-${epochNumber}`;
  const epochKey = generateGroupEpochKey();
  const sender = holders[0] as Phone;
  const epoch: ServerEpoch = {
    createdAt: new Date(Date.UTC(2026, 0, epochNumber)),
    deviceWraps: new Map(
      holders.map((holder) => [
        holder.device.deviceId,
        wrapEpochKeyForRecipient({
          epoch: {
            createdAt: new Date(0),
            createdByDeviceId: sender.device.deviceId,
            epochId,
            epochNumber,
            groupId,
          },
          epochKey,
          recipient: {
            algorithm: DEVICE_KEY_ALGORITHM,
            createdAt: new Date(0),
            deviceId: holder.device.deviceId,
            publicKey: holder.publicKey,
            revokedAt: null,
            userId,
          },
          senderPrivateKey: sender.device.privateKey,
        }),
      ]),
    ),
    epochId,
    epochKey,
    epochNumber,
    groupId,
    historyWraps: new Map(),
  };
  epochs.push(epoch);
  return epoch;
};

const addHistoryKeyVersion = (phrase: RecoveryPhrase, enrolled: Phone[]) => {
  const version = historyKeys.length + 1;
  const historyKey = createHistoryKeyPair();
  historyKeys.push({
    escrow: sealHistoryKeyEscrow({
      historyPrivateKey: historyKey.privateKey,
      recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
      userId,
      version,
    }),
    id: globalThis.crypto.randomUUID(),
    publicKey: historyKey.publicKey,
    version,
  });
  for (const holder of enrolled) {
    holder.secureStore.set(`${userId}.${version}`, historyKey.privateKey);
  }
};

const backfillAs = async (reader: Phone, groupId: string) => {
  phone = reader;
  await backfillHistoryWraps({ device: reader.device, groupId });
};

const readThroughHistoryWraps = async (reader: Phone, epoch: ServerEpoch) => {
  const epochKey = await unwrapEpochKeyFromWraps({
    device: reader.device,
    epochId: epoch.epochId,
    getHistoryKey: async (version) => reader.secureStore.get(`${userId}.${version}`) ?? null,
    wraps: {
      deviceWrap: null,
      historyWraps: [...epoch.historyWraps.values()].map((wrap) => ({
        ...wrap,
        createdAt: new Date(0),
      })),
    },
  });
  return epochKey && encodeBase64(epochKey.expose());
};

const readThroughDeviceWrap = async (reader: Phone, epoch: ServerEpoch) => {
  const epochKey = await unwrapEpochKeyFromWraps({
    device: reader.device,
    epochId: epoch.epochId,
    getHistoryKey: async () => null,
    wraps: { deviceWrap: epoch.deviceWraps.get(reader.device.deviceId) ?? null, historyWraps: [] },
  });
  return epochKey && encodeBase64(epochKey.expose());
};

const keyOf = (epoch: ServerEpoch) => encodeBase64(epoch.epochKey.expose());

const storedKey = (holder: Phone, version: number) =>
  encodeBase64(
    (holder.secureStore.get(`${userId}.${version}`) as HistoryPrivateKeyMaterial).expose(),
  );

const snapshotWraps = () =>
  JSON.stringify(
    epochs.map((epoch) => ({
      deviceWraps: [...epoch.deviceWraps.entries()],
      historyWraps: [...epoch.historyWraps.entries()],
    })),
  );

const snapshotRecovery = () => JSON.stringify({ historyKeys, recoveryKey });

const enrolledPhone = createPhone("device-1");

const setUpTwoVersions = async () => {
  phone = enrolledPhone;
  const phrase = generateRecoveryPhrase();
  const earlier = createEpoch({ epochNumber: 1, groupId: "group-a", holders: [enrolledPhone] });
  expect((await setUpRecoveryPhrase(phrase)).status).toBe("created");
  await backfillAs(enrolledPhone, "group-a");
  const underV1 = createEpoch({ epochNumber: 2, groupId: "group-a", holders: [enrolledPhone] });
  await backfillAs(enrolledPhone, "group-a");
  addHistoryKeyVersion(phrase, [enrolledPhone]);
  const underV2 = createEpoch({ epochNumber: 1, groupId: "group-b", holders: [enrolledPhone] });
  await backfillAs(enrolledPhone, "group-b");
  phone = enrolledPhone;
  return { epochs: [earlier, underV1, underV2], phrase };
};

beforeEach(() => {
  enrolledPhone.secureStore.clear();
  phone = enrolledPhone;
  recoveryKey = null;
  historyKeys = [];
  epochs = [];
  groupIds = ["group-a", "group-b"];
  sessionFresh = true;
  beforeRecoveryWrite = null;
  failingGroupId = null;
  failingReadVersion = null;
  failNextStore = false;
  serverInputs.length = 0;
  changePhraseMock.mockClear();
  resetMock.mockClear();
});

describe("changeRecoveryPhrase", () => {
  test("re-seals every version to the new phrase without touching epochs or wraps", async () => {
    const { epochs: readable, phrase: oldPhrase } = await setUpTwoVersions();
    const wrapsBefore = snapshotWraps();
    const keysBefore = historyKeys.map(({ id, publicKey, version }) => ({
      id,
      publicKey,
      version,
    }));
    const escrowsBefore = historyKeys.map(({ escrow }) => escrow.enc);
    const newPhrase = generateRecoveryPhrase();

    expect(await changeRecoveryPhrase(newPhrase)).toEqual({ status: "changed", versions: [1, 2] });

    expect(recoveryKey?.publicKey).toBe(deriveRecoveryKeyPair(newPhrase).publicKey);
    expect(historyKeys.map(({ id, publicKey, version }) => ({ id, publicKey, version }))).toEqual(
      keysBefore,
    );
    for (const [index, row] of historyKeys.entries()) {
      expect(row.escrow.enc).not.toBe(escrowsBefore[index]);
      const opened = openHistoryKeyEscrow({
        escrow: row.escrow,
        historyKey: { publicKey: row.publicKey, userId, version: row.version },
        recoveryPrivateKey: deriveRecoveryKeyPair(newPhrase).privateKey,
      });
      expect(encodeBase64(opened.expose())).toBe(storedKey(enrolledPhone, row.version));
      expect(() =>
        openHistoryKeyEscrow({
          escrow: row.escrow,
          historyKey: { publicKey: row.publicKey, userId, version: row.version },
          recoveryPrivateKey: deriveRecoveryKeyPair(oldPhrase).privateKey,
        }),
      ).toThrow();
    }
    expect(snapshotWraps()).toBe(wrapsBefore);
    for (const epoch of readable) {
      expect(await readThroughHistoryWraps(enrolledPhone, epoch)).toBe(keyOf(epoch));
      expect(await readThroughDeviceWrap(enrolledPhone, epoch)).toBe(keyOf(epoch));
    }
  });

  test("the new phrase restores every version on a fresh phone and the old phrase no longer matches", async () => {
    const { epochs: readable, phrase: oldPhrase } = await setUpTwoVersions();
    const newPhrase = generateRecoveryPhrase();
    await changeRecoveryPhrase(newPhrase);
    const freshPhone = createPhone("device-2");
    phone = freshPhone;

    await expect(restoreFromRecoveryPhrase(oldPhrase)).rejects.toThrow(PHRASE_MISMATCH_MESSAGE);
    expect(freshPhone.secureStore.size).toBe(0);
    expect(await restoreFromRecoveryPhrase(newPhrase)).toEqual({ userId, versions: [1, 2] });

    for (const version of [1, 2]) {
      expect(storedKey(freshPhone, version)).toBe(storedKey(enrolledPhone, version));
    }
    for (const epoch of readable) {
      expect(await readThroughHistoryWraps(freshPhone, epoch)).toBe(keyOf(epoch));
    }
  });

  test("a phone missing a version sends nothing", async () => {
    await setUpTwoVersions();
    enrolledPhone.secureStore.delete(`${userId}.1`);
    const before = snapshotRecovery();

    await expect(changeRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      MISSING_HISTORY_KEYS_MESSAGE,
    );

    expect(changePhraseMock).not.toHaveBeenCalled();
    expect(snapshotRecovery()).toBe(before);
  });

  test("a failure reading any version sends nothing", async () => {
    await setUpTwoVersions();
    failingReadVersion = 2;
    const before = snapshotRecovery();

    await expect(changeRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      "SecureStore unavailable",
    );

    expect(changePhraseMock).not.toHaveBeenCalled();
    expect(snapshotRecovery()).toBe(before);
  });

  test("a stored key that doesn't match the published key sends nothing", async () => {
    await setUpTwoVersions();
    enrolledPhone.secureStore.set(`${userId}.1`, createHistoryKeyPair().privateKey);
    const before = snapshotRecovery();

    await expect(changeRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      HISTORY_KEYS_MISMATCH_MESSAGE,
    );

    expect(changePhraseMock).not.toHaveBeenCalled();
    expect(snapshotRecovery()).toBe(before);
  });

  test("versions changing underneath give a conflict and change nothing", async () => {
    const { phrase } = await setUpTwoVersions();
    const storedBefore = [...enrolledPhone.secureStore.keys()];
    beforeRecoveryWrite = () => {
      beforeRecoveryWrite = null;
      addHistoryKeyVersion(phrase, []);
    };
    const before = () => JSON.stringify({ escrows: historyKeys.slice(0, 2), recoveryKey });
    const recoveryBefore = before();

    await expect(changeRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      RECOVERY_CHANGED_MESSAGE,
    );

    expect(changePhraseMock).toHaveBeenCalledTimes(1);
    expect(before()).toBe(recoveryBefore);
    expect([...enrolledPhone.secureStore.keys()]).toEqual(storedBefore);
  });

  test("an account without a phrase sends no change", async () => {
    await expect(changeRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      RECOVERY_CHANGED_MESSAGE,
    );
    expect(changePhraseMock).not.toHaveBeenCalled();
  });

  test("a stale session asks for a fresh sign-in, changes nothing, then succeeds", async () => {
    const { phrase: oldPhrase } = await setUpTwoVersions();
    sessionFresh = false;
    const before = snapshotRecovery();
    const newPhrase = generateRecoveryPhrase();

    expect(await changeRecoveryPhrase(newPhrase)).toEqual({ status: "reauthenticate" });
    expect(snapshotRecovery()).toBe(before);
    expect(recoveryKey?.publicKey).toBe(deriveRecoveryKeyPair(oldPhrase).publicKey);

    sessionFresh = true;
    expect((await changeRecoveryPhrase(newPhrase)).status).toBe("changed");
    expect(recoveryKey?.publicKey).toBe(deriveRecoveryKeyPair(newPhrase).publicKey);
  });
});

describe("resetRecoveryPhrase", () => {
  const setUpLostPhrase = async () => {
    const { epochs: enrolledOnly, phrase: oldPhrase } = await setUpTwoVersions();
    const resettingPhone = createPhone("device-2");
    const shared = [
      createEpoch({ epochNumber: 3, groupId: "group-a", holders: [enrolledPhone, resettingPhone] }),
      createEpoch({ epochNumber: 4, groupId: "group-a", holders: [enrolledPhone, resettingPhone] }),
      createEpoch({ epochNumber: 2, groupId: "group-b", holders: [enrolledPhone, resettingPhone] }),
    ];
    await backfillAs(enrolledPhone, "group-a");
    await backfillAs(enrolledPhone, "group-b");
    phone = resettingPhone;
    return { enrolledOnly, oldPhrase, resettingPhone, shared };
  };

  test("creates v(N+1) under the new phrase, stores it and removes every old history wrap", async () => {
    const { resettingPhone } = await setUpLostPhrase();
    const newPhrase = generateRecoveryPhrase();

    const result = await resetRecoveryPhrase(newPhrase);

    expect(result.status).toBe("reset");
    expect(result).toMatchObject({ version: 3 });
    expect(recoveryKey?.publicKey).toBe(deriveRecoveryKeyPair(newPhrase).publicKey);
    expect(historyKeys.map(({ version }) => version)).toEqual([3]);
    const [row] = historyKeys as [ServerHistoryKey];
    const opened = openHistoryKeyEscrow({
      escrow: row.escrow,
      historyKey: { publicKey: row.publicKey, userId, version: 3 },
      recoveryPrivateKey: deriveRecoveryKeyPair(newPhrase).privateKey,
    });
    expect(encodeBase64(opened.expose())).toBe(storedKey(resettingPhone, 3));
    expect([...resettingPhone.secureStore.keys()]).toEqual([`${userId}.3`]);
    expect(epochs.every((epoch) => epoch.historyWraps.size === 0)).toBe(true);
    expect(resetMock.mock.calls[0]?.[0]).toMatchObject({ confirmReset: true });
  });

  test("backfill restores coverage for the epochs this phone holds and reports the rest as gaps", async () => {
    const { enrolledOnly, resettingPhone, shared } = await setUpLostPhrase();
    const newPhrase = generateRecoveryPhrase();
    const result = await resetRecoveryPhrase(newPhrase);
    if (result.status !== "reset") throw new Error("Reset failed");
    const progress: { done: number; failed: number; total: number }[] = [];

    expect(
      await backfillEveryGroup({ device: result.device, onProgress: (p) => progress.push(p) }),
    ).toEqual({ done: 2, failed: 0, total: 2 });
    expect(progress.at(0)).toEqual({ done: 0, failed: 0, total: 2 });

    for (const epoch of shared) {
      expect(await readThroughHistoryWraps(resettingPhone, epoch)).toBe(keyOf(epoch));
    }
    for (const epoch of enrolledOnly) {
      expect(await readThroughHistoryWraps(resettingPhone, epoch)).toBeNull();
    }
    const groupA = epochs
      .filter(({ groupId }) => groupId === "group-a")
      .sort((a, b) => b.epochNumber - a.epochNumber);
    expect(
      await checkGroupKeyAccess({
        canResolve: async (epoch: ServerEpoch) =>
          (await readThroughHistoryWraps(resettingPhone, epoch)) !== null,
        listEpochs: async () => ({ epochs: groupA, nextCursor: null }),
      }),
    ).toEqual({ current: "available", history: { partialFrom: new Date(Date.UTC(2026, 0, 3)) } });

    const freshPhone = createPhone("device-3");
    phone = freshPhone;
    expect(await restoreFromRecoveryPhrase(newPhrase)).toEqual({ userId, versions: [3] });
    for (const epoch of shared) {
      expect(await readThroughHistoryWraps(freshPhone, epoch)).toBe(keyOf(epoch));
    }
  });

  test("the old phrase stops matching and other enrolled phones are told the current version is missing", async () => {
    const { enrolledOnly, oldPhrase } = await setUpLostPhrase();
    await resetRecoveryPhrase(generateRecoveryPhrase());

    phone = createPhone("device-3");
    await expect(restoreFromRecoveryPhrase(oldPhrase)).rejects.toThrow(PHRASE_MISMATCH_MESSAGE);
    phone = enrolledPhone;
    expect(await findMissingHistoryKey()).toEqual({ userId, version: 3 });
    for (const epoch of enrolledOnly) {
      expect(await readThroughHistoryWraps(enrolledPhone, epoch)).toBeNull();
      expect(await readThroughDeviceWrap(enrolledPhone, epoch)).toBe(keyOf(epoch));
    }
  });

  test("a reset that loses a race gets a conflict and stores nothing", async () => {
    const { oldPhrase, resettingPhone } = await setUpLostPhrase();
    beforeRecoveryWrite = () => {
      beforeRecoveryWrite = null;
      addHistoryKeyVersion(oldPhrase, []);
    };

    await expect(resetRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      RECOVERY_CHANGED_MESSAGE,
    );

    expect(historyKeys.map(({ version }) => version)).toEqual([1, 2, 3]);
    expect(recoveryKey?.publicKey).toBe(deriveRecoveryKeyPair(oldPhrase).publicKey);
    expect(resettingPhone.secureStore.size).toBe(0);
  });

  test("a stale session asks for a fresh sign-in and changes nothing", async () => {
    const { resettingPhone } = await setUpLostPhrase();
    sessionFresh = false;
    const recoveryBefore = snapshotRecovery();
    const wrapsBefore = snapshotWraps();

    expect(await resetRecoveryPhrase(generateRecoveryPhrase())).toEqual({
      status: "reauthenticate",
    });

    expect(snapshotRecovery()).toBe(recoveryBefore);
    expect(snapshotWraps()).toBe(wrapsBefore);
    expect(resettingPhone.secureStore.size).toBe(0);
  });

  test("an account without a phrase sends no reset", async () => {
    await expect(resetRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      RECOVERY_CHANGED_MESSAGE,
    );
    expect(resetMock).not.toHaveBeenCalled();
  });

  test("a phone that can't save the new key is sent to restore, which then stores it", async () => {
    const { resettingPhone } = await setUpLostPhrase();
    const newPhrase = generateRecoveryPhrase();
    failNextStore = true;

    expect((await resetRecoveryPhrase(newPhrase)).status).toBe("unsaved");
    expect(historyKeys.map(({ version }) => version)).toEqual([3]);
    expect(resettingPhone.secureStore.size).toBe(0);
    expect(await findMissingHistoryKey()).toEqual({ userId, version: 3 });

    expect(await restoreFromRecoveryPhrase(newPhrase)).toEqual({ userId, versions: [3] });
    expect(await findMissingHistoryKey()).toBeNull();
  });
});

describe("backfillEveryGroup", () => {
  test("counts failed groups without stopping the others", async () => {
    await setUpTwoVersions();
    const pending = createEpoch({ epochNumber: 9, groupId: "group-b", holders: [enrolledPhone] });
    failingGroupId = "group-a";
    createEpoch({ epochNumber: 9, groupId: "group-a", holders: [enrolledPhone] });

    expect(
      await backfillEveryGroup({ device: enrolledPhone.device, onProgress: () => {} }),
    ).toEqual({ done: 2, failed: 1, total: 2 });
    expect(await readThroughHistoryWraps(enrolledPhone, pending)).toBe(keyOf(pending));
  });

  test("a failed group list counts as a failure", async () => {
    listGroupsMock.mockImplementationOnce(async () => {
      throw new Error("Network error");
    });

    expect(
      await backfillEveryGroup({ device: enrolledPhone.device, onProgress: () => {} }),
    ).toEqual({ done: 0, failed: 1, total: 0 });
  });
});

describe("secrets never reach the server", () => {
  test("change, reset and the following backfill send no phrase words or key bytes", async () => {
    const { phrase: firstPhrase } = await setUpTwoVersions();
    const enrolledKeys = [1, 2].map((version) =>
      (enrolledPhone.secureStore.get(`${userId}.${version}`) as HistoryPrivateKeyMaterial).expose(),
    );
    const changedPhrase = generateRecoveryPhrase();
    const resettingPhone = createPhone("device-2");
    const shared = Array.from({ length: 4 }, (_, index) =>
      createEpoch({
        epochNumber: index + 10,
        groupId: "group-a",
        holders: [enrolledPhone, resettingPhone],
      }),
    );
    serverInputs.length = 0;

    await changeRecoveryPhrase(changedPhrase);
    phone = resettingPhone;
    const resetPhrase = generateRecoveryPhrase();
    const result = await resetRecoveryPhrase(resetPhrase);
    if (result.status !== "reset") throw new Error("Reset failed");
    await backfillEveryGroup({ device: result.device, onProgress: () => {} });
    expect(addHistoryWrapsMock).toHaveBeenCalled();
    for (const epoch of shared) {
      expect(await readThroughHistoryWraps(resettingPhone, epoch)).toBe(keyOf(epoch));
    }

    const serialized = JSON.stringify(serverInputs);
    const secrets = [
      ...[firstPhrase, changedPhrase, resetPhrase].map((phrase) =>
        deriveRecoveryKeyPair(phrase).privateKey.expose(),
      ),
      ...enrolledKeys,
      (resettingPhone.secureStore.get(`${userId}.3`) as HistoryPrivateKeyMaterial).expose(),
      enrolledPhone.device.privateKey.expose(),
      resettingPhone.device.privateKey.expose(),
      ...epochs.map(({ epochKey }) => epochKey.expose()),
    ];
    expectNoSecretsIn(serialized, { secrets, phrases: [firstPhrase, changedPhrase, resetPhrase] });
  });
});
