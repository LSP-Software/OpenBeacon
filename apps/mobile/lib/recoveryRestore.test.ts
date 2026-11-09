import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  decodeJsonPayload,
  decryptGroupPayload,
  DEVICE_KEY_ALGORITHM,
  deriveRecoveryKeyPair,
  encodeBase64,
  encryptGroupPayload,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  generateRecoveryPhrase,
  type HistoryKeyEscrow,
  type HistoryPrivateKeyMaterial,
  RecoveryPhrase,
  RecoveryPrivateKeyMaterial,
  sealHistoryKeyEscrow,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";
import { expectNoSecretsIn } from "../test/secretLeaks.testUtil.ts";
import { setupAccountRecoverySchema } from "@openbeacon/schemas";
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
  deviceWraps: Map<string, WrappedEpochKey>;
  epochId: string;
  epochKey: EpochKeyMaterial;
  epochNumber: number;
  groupId: string;
  historyWraps: Map<number, WrappedHistoryEpochKey>;
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
let escrowsOverride: ((rows: ServerHistoryKey[]) => ServerHistoryKey[]) | null;
let epochs: ServerEpoch[];
let failNextStore: boolean;
let escrowUserId: string;
const serverInputs: unknown[] = [];

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
  return (escrowsOverride?.(historyKeys) ?? historyKeys).map((row) => ({
    ...row,
    userId: escrowUserId,
  }));
});

const setupMock = mock(async (input: unknown) => {
  serverInputs.push(input);
  if (recoveryKey) {
    throw TRPCClientError.from({
      error: { code: -32009, data: { code: "CONFLICT" }, message: "Already set up" },
    });
  }
  const parsed = setupAccountRecoverySchema.parse(input);
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
            !epoch.historyWraps.has(current.version),
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
  async (input: { historyKeyId: string; wraps: WrappedHistoryEpochKey[] }) => {
    serverInputs.push(input);
    for (const wrap of input.wraps) {
      epochs
        .find(({ epochId }) => epochId === wrap.epochId)
        ?.historyWraps.set(wrap.historyKeyVersion, wrap);
    }
    return { added: input.wraps.length };
  },
);

mock.module("./api.ts", () => ({
  trpcClient: {
    accountRecovery: {
      escrows: { query: escrowsMock },
      setup: { mutate: setupMock },
      status: { query: statusMock },
    },
    groupEpoch: {
      addHistoryWraps: { mutate: addHistoryWrapsMock },
      listHistoryBackfill: { query: listHistoryBackfillMock },
    },
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
  getStoredHistoryKey: async (input: { userId: string; version: number }) =>
    phone.secureStore.get(`${input.userId}.${input.version}`) ?? null,
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
  backfillHistoryWraps,
  findMissingHistoryKey,
  PHRASE_MISMATCH_MESSAGE,
  RECOVERY_DATA_MISMATCH_MESSAGE,
  restoreFromRecoveryPhrase,
  setUpRecoveryPhrase,
} = await import("./recovery.ts");
const { unwrapEpochKeyFromWraps } = await import("./epochKeys.ts");

const createEpoch = ({
  epochNumber,
  groupId,
  holders,
  withHistoryWrap = true,
}: {
  epochNumber: number;
  groupId: string;
  holders: Phone[];
  withHistoryWrap?: boolean;
}) => {
  const epochId = `${groupId}-epoch-${epochNumber}`;
  const epochKey = generateGroupEpochKey();
  const sender = holders[0] as Phone;
  const historyKey = currentHistoryKey();
  const epoch: ServerEpoch = {
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
  if (withHistoryWrap && historyKey) {
    epoch.historyWraps.set(
      historyKey.version,
      wrapEpochKeyForHistoryKey({
        epochId,
        epochKey,
        historyKey: { publicKey: historyKey.publicKey, userId, version: historyKey.version },
        senderPrivateKey: sender.device.privateKey,
      }),
    );
  }
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
  for (const holder of enrolled)
    holder.secureStore.set(`${userId}.${version}`, historyKey.privateKey);
};

const unwrapAs = (reader: Phone, epoch: ServerEpoch, { useDeviceWrap = false } = {}) =>
  unwrapEpochKeyFromWraps({
    device: reader.device,
    epochId: epoch.epochId,
    getHistoryKey: async (version) => reader.secureStore.get(`${userId}.${version}`) ?? null,
    wraps: {
      deviceWrap: useDeviceWrap ? (epoch.deviceWraps.get(reader.device.deviceId) ?? null) : null,
      historyWraps: [...epoch.historyWraps.values()].map((wrap) => ({
        ...wrap,
        createdAt: new Date(0),
      })),
    },
  });

const readEpoch = async (
  reader: Phone,
  epoch: ServerEpoch,
  options: { useDeviceWrap?: boolean } = {},
) => {
  const epochKey = await unwrapAs(reader, epoch, options);
  return epochKey && encodeBase64(epochKey.expose());
};

const expectReadable = async (
  reader: Phone,
  epoch: ServerEpoch,
  options: { useDeviceWrap?: boolean } = {},
) => expect(await readEpoch(reader, epoch, options)).toBe(encodeBase64(epoch.epochKey.expose()));

const firstPhone = createPhone("device-1");

const setUpOnFirstPhone = async () => {
  phone = firstPhone;
  const phrase = generateRecoveryPhrase();
  expect((await setUpRecoveryPhrase(phrase)).status).toBe("created");
  return phrase;
};

beforeEach(() => {
  firstPhone.secureStore.clear();
  phone = firstPhone;
  recoveryKey = null;
  historyKeys = [];
  escrowsOverride = null;
  epochs = [];
  failNextStore = false;
  escrowUserId = userId;
  serverInputs.length = 0;
  statusMock.mockClear();
  escrowsMock.mockClear();
  addHistoryWrapsMock.mockClear();
});

describe("restoreFromRecoveryPhrase", () => {
  test("a fresh phone in several groups stores every version and reads past and current epochs through history wraps", async () => {
    const preSetupEpochs = [
      createEpoch({ epochNumber: 1, groupId: "group-a", holders: [firstPhone] }),
      createEpoch({ epochNumber: 1, groupId: "group-b", holders: [firstPhone] }),
    ];
    const phrase = await setUpOnFirstPhone();
    await backfillHistoryWraps({ device: firstPhone.device, groupId: "group-a" });
    await backfillHistoryWraps({ device: firstPhone.device, groupId: "group-b" });
    const v1Epochs = [
      createEpoch({ epochNumber: 2, groupId: "group-a", holders: [firstPhone] }),
      createEpoch({ epochNumber: 2, groupId: "group-b", holders: [firstPhone] }),
    ];
    addHistoryKeyVersion(phrase, [firstPhone]);
    const currentEpochs = [
      createEpoch({ epochNumber: 3, groupId: "group-a", holders: [firstPhone] }),
      createEpoch({ epochNumber: 3, groupId: "group-b", holders: [firstPhone] }),
    ];
    const newPhone = createPhone("device-2");
    phone = newPhone;

    const result = await restoreFromRecoveryPhrase(
      new RecoveryPhrase(new TextEncoder().encode(phrase.words().join(" "))),
    );

    expect(result).toEqual({ userId, versions: [1, 2] });
    expect([...newPhone.secureStore.keys()].sort()).toEqual([`${userId}.1`, `${userId}.2`]);
    for (const version of [1, 2]) {
      expect(
        encodeBase64(
          (newPhone.secureStore.get(`${userId}.${version}`) as HistoryPrivateKeyMaterial).expose(),
        ),
      ).toBe(
        encodeBase64(
          (
            firstPhone.secureStore.get(`${userId}.${version}`) as HistoryPrivateKeyMaterial
          ).expose(),
        ),
      );
    }
    for (const epoch of [...preSetupEpochs, ...v1Epochs, ...currentEpochs]) {
      expect(epoch.deviceWraps.has(newPhone.device.deviceId)).toBe(false);
      await expectReadable(newPhone, epoch);
    }
  });

  test("a wrong phrase is rejected with the mismatch message and stores nothing", async () => {
    await setUpOnFirstPhone();
    phone = createPhone("device-2");

    await expect(restoreFromRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      PHRASE_MISMATCH_MESSAGE,
    );
    expect(phone.secureStore.size).toBe(0);
    expect(escrowsMock).not.toHaveBeenCalled();
  });

  test("an account without a phrase stores nothing", async () => {
    await expect(restoreFromRecoveryPhrase(generateRecoveryPhrase())).rejects.toThrow(
      PHRASE_MISMATCH_MESSAGE,
    );
    expect(phone.secureStore.size).toBe(0);
  });

  for (const change of [{ derivationVersion: 2 }, { algorithm: "P-256" }]) {
    test(`rejects a recovery key with ${JSON.stringify(change)} even when the public key matches`, async () => {
      const phrase = await setUpOnFirstPhone();
      recoveryKey = { ...(recoveryKey as NonNullable<typeof recoveryKey>), ...change };
      phone = createPhone("device-2");

      await expect(restoreFromRecoveryPhrase(phrase)).rejects.toThrow(PHRASE_MISMATCH_MESSAGE);
      expect(phone.secureStore.size).toBe(0);
    });
  }

  test("binds escrows to this phone's user even if the server names another", async () => {
    const phrase = await setUpOnFirstPhone();
    escrowUserId = "user-2";
    phone = createPhone("device-2");

    expect(await restoreFromRecoveryPhrase(phrase)).toEqual({ userId, versions: [1] });
  });

  const escrowAttacks: [
    string,
    (rows: ServerHistoryKey[], phrase: RecoveryPhrase) => ServerHistoryKey[],
  ][] = [
    [
      "a tampered ciphertext on the older version",
      (rows) =>
        rows.map((row) =>
          row.version === 1
            ? {
                ...row,
                escrow: { ...row.escrow, ciphertext: flipFirstByte(row.escrow.ciphertext) },
              }
            : row,
        ),
    ],
    [
      "a tampered ciphertext on the current version",
      (rows) =>
        rows.map((row) =>
          row.version === 2
            ? {
                ...row,
                escrow: { ...row.escrow, ciphertext: flipFirstByte(row.escrow.ciphertext) },
              }
            : row,
        ),
    ],
    [
      "escrows swapped between versions",
      ([first, second]) => [
        { ...(first as ServerHistoryKey), escrow: (second as ServerHistoryKey).escrow },
        { ...(second as ServerHistoryKey), escrow: (first as ServerHistoryKey).escrow },
      ],
    ],
    [
      "versions relabelled",
      ([first, second]) =>
        [
          { ...(first as ServerHistoryKey), version: 2 },
          { ...(second as ServerHistoryKey), version: 1 },
        ].reverse(),
    ],
    [
      "a substituted public key on the older version",
      (rows) =>
        rows.map((row) =>
          row.version === 1 ? { ...row, publicKey: createHistoryKeyPair().publicKey } : row,
        ),
    ],
    [
      "an escrow sealed for another user",
      (rows, phrase) =>
        rows.map((row) =>
          row.version === 1
            ? {
                ...row,
                escrow: sealHistoryKeyEscrow({
                  historyPrivateKey: firstPhone.secureStore.get(
                    `${userId}.1`,
                  ) as HistoryPrivateKeyMaterial,
                  recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
                  userId: "user-2",
                  version: 1,
                }),
              }
            : row,
        ),
    ],
    ["a missing version", (rows) => rows.filter(({ version }) => version !== 1)],
    ["a duplicated version", (rows) => [rows[0] as ServerHistoryKey, ...rows]],
    ["no escrows", () => []],
    [
      "an unknown escrow algorithm",
      (rows) =>
        rows.map((row) =>
          row.version === 1
            ? {
                ...row,
                escrow: { ...row.escrow, algorithm: "other" } as unknown as HistoryKeyEscrow,
              }
            : row,
        ),
    ],
  ];

  for (const [name, attack] of escrowAttacks) {
    test(`rejects ${name} and stores nothing`, async () => {
      const phrase = await setUpOnFirstPhone();
      addHistoryKeyVersion(phrase, [firstPhone]);
      escrowsOverride = (rows) => attack(rows, phrase);
      phone = createPhone("device-2");

      await expect(restoreFromRecoveryPhrase(phrase)).rejects.toThrow(
        RECOVERY_DATA_MISMATCH_MESSAGE,
      );
      expect(phone.secureStore.size).toBe(0);
    });
  }

  test("rejects consistent escrows the server forged for its own history keys and stores nothing", async () => {
    const phrase = await setUpOnFirstPhone();
    addHistoryKeyVersion(phrase, [firstPhone]);
    const serverKey = new RecoveryPrivateKeyMaterial(
      globalThis.crypto.getRandomValues(new Uint8Array(32)),
    );
    escrowsOverride = (rows) =>
      rows.map((row) => {
        const forged = createHistoryKeyPair();
        return {
          ...row,
          escrow: sealHistoryKeyEscrow({
            historyPrivateKey: forged.privateKey,
            recoveryPrivateKey: serverKey,
            userId,
            version: row.version,
          }),
          publicKey: forged.publicKey,
        };
      });
    phone = createPhone("device-2");

    await expect(restoreFromRecoveryPhrase(phrase)).rejects.toThrow(RECOVERY_DATA_MISMATCH_MESSAGE);
    expect(phone.secureStore.size).toBe(0);
  });

  test("a second phone restores while the first stays enrolled, and a later epoch is readable on both", async () => {
    const phrase = await setUpOnFirstPhone();
    const earlier = createEpoch({ epochNumber: 1, groupId: "group-a", holders: [firstPhone] });
    const firstPhoneKey = encodeBase64(
      (firstPhone.secureStore.get(`${userId}.1`) as HistoryPrivateKeyMaterial).expose(),
    );
    const secondPhone = createPhone("device-2");
    phone = secondPhone;

    await restoreFromRecoveryPhrase(phrase);
    const later = createEpoch({
      epochNumber: 2,
      groupId: "group-a",
      holders: [firstPhone, secondPhone],
    });

    expect(
      encodeBase64(
        (firstPhone.secureStore.get(`${userId}.1`) as HistoryPrivateKeyMaterial).expose(),
      ),
    ).toBe(firstPhoneKey);
    for (const reader of [firstPhone, secondPhone]) {
      await expectReadable(reader, earlier);
      await expectReadable(reader, later);
      await expectReadable(reader, later, { useDeviceWrap: true });
    }
  });

  test("ciphertext queued offline before a reinstall decrypts after restore", async () => {
    const phrase = await setUpOnFirstPhone();
    const epoch = createEpoch({ epochNumber: 1, groupId: "group-a", holders: [firstPhone] });
    const metadata = {
      epochId: epoch.epochId,
      groupId: "group-a",
      kind: "location",
      senderDeviceId: firstPhone.device.deviceId,
    };
    const queued = encryptGroupPayload({
      ...metadata,
      epochKey: epoch.epochKey,
      payload: { latitude: 51.5, longitude: -0.12 },
    });
    const reinstalled = createPhone("device-1-reinstalled");
    phone = reinstalled;
    expect(await readEpoch(reinstalled, epoch)).toBeNull();

    await restoreFromRecoveryPhrase(phrase);
    const epochKey = await unwrapAs(reinstalled, epoch);

    expect(
      decodeJsonPayload<{ latitude: number; longitude: number }>(
        decryptGroupPayload({
          encryptedPayload: queued,
          epochKey: epochKey as EpochKeyMaterial,
          expectedMetadata: metadata,
        }).bytes,
      ),
    ).toEqual({ latitude: 51.5, longitude: -0.12 });
  });

  test("a phone whose setup stored no key restores v1 when setup is retried with the same phrase", async () => {
    const phrase = generateRecoveryPhrase();
    failNextStore = true;
    expect((await setUpRecoveryPhrase(phrase)).status).toBe("unsaved");
    const epoch = createEpoch({ epochNumber: 1, groupId: "group-a", holders: [firstPhone] });
    expect(await findMissingHistoryKey()).toEqual({ userId, version: 1 });

    expect((await setUpRecoveryPhrase(phrase)).status).toBe("created");

    expect(await findMissingHistoryKey()).toBeNull();
    await expectReadable(firstPhone, epoch);
    await expectReadable(firstPhone, epoch, { useDeviceWrap: true });
  });
});

describe("findMissingHistoryKey", () => {
  test("reports nothing without a phrase, then the current version until this phone holds it", async () => {
    expect(await findMissingHistoryKey()).toBeNull();
    const phrase = await setUpOnFirstPhone();
    expect(await findMissingHistoryKey()).toBeNull();
    phone = createPhone("device-2");
    expect(await findMissingHistoryKey()).toEqual({ userId, version: 1 });
    addHistoryKeyVersion(phrase, [firstPhone]);
    expect(await findMissingHistoryKey()).toEqual({ userId, version: 2 });

    await restoreFromRecoveryPhrase(phrase);

    expect(await findMissingHistoryKey()).toBeNull();
  });

  test("reports a stored key that doesn't match the account's current key until restore replaces it", async () => {
    const phrase = await setUpOnFirstPhone();
    firstPhone.secureStore.set(`${userId}.1`, createHistoryKeyPair().privateKey);
    expect(await findMissingHistoryKey()).toEqual({ userId, version: 1 });

    await restoreFromRecoveryPhrase(phrase);

    expect(await findMissingHistoryKey()).toBeNull();
  });
});

describe("secrets never reach the server", () => {
  test("setup, restore and the restored phone's backfill send no phrase words or key bytes", async () => {
    const phrase = await setUpOnFirstPhone();
    const secondPhone = createPhone("device-2");
    const epochsForSecondPhone = Array.from({ length: 5 }, (_, index) =>
      createEpoch({
        epochNumber: index + 1,
        groupId: "group-a",
        holders: [firstPhone, secondPhone],
        withHistoryWrap: false,
      }),
    );
    phone = secondPhone;
    const inputsBeforeRestore = serverInputs.length;

    await restoreFromRecoveryPhrase(phrase);

    expect(serverInputs.slice(inputsBeforeRestore)).toStrictEqual([undefined, undefined]);
    await backfillHistoryWraps({ device: secondPhone.device, groupId: "group-a" });
    expect(addHistoryWrapsMock).toHaveBeenCalledTimes(1);
    for (const epoch of epochsForSecondPhone) await expectReadable(firstPhone, epoch);

    const serialized = JSON.stringify(serverInputs);
    const secrets = [
      deriveRecoveryKeyPair(phrase).privateKey.expose(),
      (secondPhone.secureStore.get(`${userId}.1`) as HistoryPrivateKeyMaterial).expose(),
      firstPhone.device.privateKey.expose(),
      secondPhone.device.privateKey.expose(),
      ...epochsForSecondPhone.map(({ epochKey }) => epochKey.expose()),
    ];
    expectNoSecretsIn(serialized, { secrets, phrases: [phrase] });
  });
});

const flipFirstByte = (base64: string) => {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString("base64");
};
