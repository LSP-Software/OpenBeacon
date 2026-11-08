import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  deriveRecoveryKeyPair,
  generateRecoveryPhrase,
  getPersonalDataHistoryKeyVersion,
  type HistoryKeyEscrow,
  type HistoryPrivateKeyMaterial,
  type RecoveryPhrase,
  sealHistoryKeyEscrow,
  sealPersonalDataForHistoryKey,
} from "@openbeacon/encryption";
import { expectNoSecretsIn } from "../test/secretLeaks.testUtil.ts";
import { resetAccountRecoverySchema, setupAccountRecoverySchema } from "@openbeacon/schemas";
import { TRPCClientError } from "@trpc/client";

const userId = "user-1";

const createPhone = (deviceId: string) => {
  const keyPair = createDeviceKeyPair();
  return {
    device: { deviceId, privateKey: keyPair.privateKey, userId },
    publicKey: keyPair.publicKey,
    secureStore: new Map<string, HistoryPrivateKeyMaterial>(),
    storage: new Map<string, string>(),
  };
};

type Phone = ReturnType<typeof createPhone>;

let phone: Phone;
let recoveryKey: { algorithm: string; derivationVersion: number; publicKey: string } | null;
let historyKeys: {
  escrow: HistoryKeyEscrow;
  id: string;
  publicKey: string;
  version: number;
}[];
let colors: Map<string, string>;
let nicknames: Map<string, Map<string, string>>;
let groupIds: string[];
let publishedKeyOverride: string | null;
let beforeWrite: ((input: { groupId: string; memberId?: string }) => void) | null;
let failWrite: ((input: { groupId: string; memberId?: string }) => boolean) | null;
const serverInputs: unknown[] = [];

const conflict = () =>
  TRPCClientError.from({
    error: { code: -32009, data: { code: "CONFLICT" }, message: "CONFLICT" },
  });

const statusMock = mock(async () => {
  serverInputs.push(undefined);
  const current = historyKeys.at(-1);
  return {
    currentHistoryKey: current
      ? {
          id: current.id,
          publicKey: publishedKeyOverride ?? current.publicKey,
          version: current.version,
        }
      : null,
    historyKeyVersions: historyKeys.map(({ version }) => version),
    recoveryKey,
  };
});

const updateColorMock = mock(
  async (
    input: { groupId: string; ciphertext: string; expectedCiphertext?: string },
    _options?: { signal: AbortSignal },
  ) => {
    serverInputs.push(input);
    beforeWrite?.(input);
    if (failWrite?.(input)) throw new Error("Network error");
    if (
      input.expectedCiphertext !== undefined &&
      colors.get(input.groupId) !== input.expectedCiphertext
    ) {
      throw conflict();
    }
    colors.set(input.groupId, input.ciphertext);
  },
);

const updateNicknameMock = mock(
  async (input: {
    groupId: string;
    memberId: string;
    ciphertext: string | null;
    expectedCiphertext: string | null;
  }) => {
    serverInputs.push(input);
    beforeWrite?.(input);
    if (failWrite?.(input)) throw new Error("Network error");
    const group = nicknames.get(input.groupId) ?? new Map<string, string>();
    nicknames.set(input.groupId, group);
    if ((group.get(input.memberId) ?? null) !== input.expectedCiphertext) throw conflict();
    if (input.ciphertext === null) group.delete(input.memberId);
    else group.set(input.memberId, input.ciphertext);
  },
);

mock.module("./api.ts", () => ({
  trpcClient: {
    accountRecovery: {
      escrows: {
        query: async () => {
          serverInputs.push(undefined);
          return historyKeys.map((row) => ({ ...row, userId }));
        },
      },
      reset: {
        mutate: async (input: unknown) => {
          serverInputs.push(input);
          const parsed = resetAccountRecoverySchema.parse(input);
          recoveryKey = parsed.recoveryKey;
          historyKeys = [parsed.historyKey];
          return { historyKeyVersion: parsed.historyKey.version };
        },
      },
      setup: {
        mutate: async (input: unknown) => {
          serverInputs.push(input);
          const parsed = setupAccountRecoverySchema.parse(input);
          recoveryKey = parsed.recoveryKey;
          historyKeys = [parsed.historyKey];
          return { historyKeyVersion: parsed.historyKey.version };
        },
      },
      status: { query: statusMock },
    },
    groupMembership: {
      colors: {
        query: async () => {
          serverInputs.push(undefined);
          return [...colors].map(([groupId, ciphertext]) => ({ groupId, ciphertext }));
        },
      },
      list: {
        query: async () => {
          serverInputs.push(undefined);
          return groupIds.map((id) => ({ id }));
        },
      },
      nicknames: {
        query: async (input: { groupId: string }) => {
          serverInputs.push(input);
          return [...(nicknames.get(input.groupId) ?? [])].map(([targetId, ciphertext]) => ({
            targetId,
            ciphertext,
          }));
        },
      },
      updateColor: { mutate: updateColorMock },
      updateNickname: { mutate: updateNicknameMock },
    },
  },
}));

const deviceContext = () => ({
  ...phone.device,
  algorithm: DEVICE_KEY_ALGORITHM,
  publicKey: phone.publicKey,
});

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => deviceContext(),
  getOrCreateDeviceKeyContext: async () => deviceContext(),
  getStoredDeviceKeyContext: async () => deviceContext(),
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async (input: { userId: string; version: number }) =>
    phone.secureStore.get(`${input.userId}.${input.version}`) ?? null,
  storeHistoryKey: async (input: {
    privateKey: HistoryPrivateKeyMaterial;
    userId: string;
    version: number;
  }) => {
    phone.secureStore.set(`${input.userId}.${input.version}`, input.privateKey);
  },
}));

mock.module("./storage.ts", () => ({
  storage: {
    getAllKeys: () => [...phone.storage.keys()],
    getString: (key: string) => phone.storage.get(key),
    remove: (key: string) => phone.storage.delete(key),
    set: (key: string, value: string) => {
      phone.storage.set(key, value);
    },
  },
}));

const { PERSONAL_DATA_KEY_MISMATCH_MESSAGE, PERSONAL_DATA_LOCKED_MESSAGE, sealForSelf } =
  await import("./personalData.ts");
const { encryptPersonalNickname, loadPersonalNicknames } = await import("./personalNicknames.ts");
const { saveGroupColor, syncGroupColors } = await import("./groupColorSync.ts");
const { resealPersonalData } = await import("./resealPersonalData.ts");
const { getGroupColor, GROUP_COLOR_PALETTE } = await import("./groupColor.ts");
const { resetRecoveryPhrase, restoreFromRecoveryPhrase, setUpRecoveryPhrase } =
  await import("./recovery.ts");

const addHistoryKeyVersion = (phrase: RecoveryPhrase, enrolled: Phone[]) => {
  const version = (historyKeys.at(-1)?.version ?? 0) + 1;
  const historyKey = createHistoryKeyPair();
  const recovery = deriveRecoveryKeyPair(phrase);
  recoveryKey = {
    algorithm: recovery.algorithm,
    derivationVersion: recovery.derivationVersion,
    publicKey: recovery.publicKey,
  };
  historyKeys.push({
    escrow: sealHistoryKeyEscrow({
      historyPrivateKey: historyKey.privateKey,
      recoveryPrivateKey: recovery.privateKey,
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
  return version;
};

const saveNickname = async (groupId: string, memberId: string, nickname: string) => {
  await updateNicknameMock({
    groupId,
    memberId,
    ciphertext: await encryptPersonalNickname({ groupId, memberId, userId, nickname }),
    expectedCiphertext: nicknames.get(groupId)?.get(memberId) ?? null,
  });
};

const readAs = async (reader: Phone, groupId: string) => {
  phone = reader;
  const loaded = await loadPersonalNicknames(groupId, userId);
  return Object.fromEntries(Object.entries(loaded).map(([memberId, { name }]) => [memberId, name]));
};

const versionsOnServer = () => [
  ...[...colors.values()].map(getPersonalDataHistoryKeyVersion),
  ...[...nicknames.values()].flatMap((group) =>
    [...group.values()].map(getPersonalDataHistoryKeyVersion),
  ),
];

const writes = () => updateColorMock.mock.calls.length + updateNicknameMock.mock.calls.length;

let setupPhone: Phone;

beforeEach(() => {
  setupPhone = createPhone("handset-a");
  phone = setupPhone;
  recoveryKey = null;
  historyKeys = [];
  colors = new Map();
  nicknames = new Map();
  groupIds = ["household", "friends"];
  publishedKeyOverride = null;
  beforeWrite = null;
  failWrite = null;
  serverInputs.length = 0;
  updateColorMock.mockClear();
  updateNicknameMock.mockClear();
});

const writeV2Records = async () => {
  await saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[3] });
  await saveGroupColor({ userId, groupId: "friends", color: GROUP_COLOR_PALETTE[5] });
  await saveNickname("household", "gran", "Grandma");
  await saveNickname("household", "papa", "Papa Bear");
  await saveNickname("friends", "sam", "Sammy");
  expect(versionsOnServer()).toStrictEqual([null, null, null, null, null]);
};

describe("sealing", () => {
  test("a phone holding the current history key seals v3 bound to that version", async () => {
    const phrase = generateRecoveryPhrase();
    addHistoryKeyVersion(phrase, [setupPhone]);
    addHistoryKeyVersion(phrase, [setupPhone]);

    await saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[2] });
    await saveNickname("household", "gran", "Grandma");

    expect(versionsOnServer()).toStrictEqual([2, 2]);
    expect(updateColorMock.mock.calls[0]?.[0].expectedCiphertext).toBeUndefined();
    const otherPhone = createPhone("handset-b");
    otherPhone.secureStore = new Map(setupPhone.secureStore);
    expect(await readAs(otherPhone, "household")).toStrictEqual({ gran: "Grandma" });
  });

  test("an account without a phrase keeps sealing to the device key", async () => {
    await saveNickname("household", "gran", "Grandma");
    await saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[2] });

    expect(versionsOnServer()).toStrictEqual([null, null]);
    expect(await readAs(setupPhone, "household")).toStrictEqual({ gran: "Grandma" });
    const reinstalled = createPhone("reinstalled");
    expect(await readAs(reinstalled, "household")).toStrictEqual({ gran: null });
  });

  test("a phone without the current history key refuses to seal on an account with a phrase", async () => {
    const phrase = generateRecoveryPhrase();
    const enrolled = createPhone("enrolled");
    addHistoryKeyVersion(phrase, [enrolled, setupPhone]);
    addHistoryKeyVersion(phrase, [enrolled]);

    await expect(
      saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[2] }),
    ).rejects.toThrow(PERSONAL_DATA_LOCKED_MESSAGE);
    await expect(saveNickname("household", "gran", "Grandma")).rejects.toThrow(
      PERSONAL_DATA_LOCKED_MESSAGE,
    );
    expect(writes()).toBe(0);
    expect(getGroupColor("household")).toBe(GROUP_COLOR_PALETTE[0]);
  });

  test("a published key that doesn't match the stored key is never sealed to", async () => {
    await writeV2Records();
    updateColorMock.mockClear();
    updateNicknameMock.mockClear();
    addHistoryKeyVersion(generateRecoveryPhrase(), [setupPhone]);
    publishedKeyOverride = createHistoryKeyPair().publicKey;

    await resealPersonalData(userId);
    expect(writes()).toBe(0);
    await expect(
      sealForSelf({ userId, purpose: "nickname", binding: [userId], plaintext: "Gran" }),
    ).rejects.toThrow(PERSONAL_DATA_KEY_MISMATCH_MESSAGE);
    await expect(
      saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[2] }),
    ).rejects.toThrow(PERSONAL_DATA_KEY_MISMATCH_MESSAGE);
    expect(writes()).toBe(0);
  });
});

describe("opening", () => {
  test("a record sealed under v1 still opens after v2 exists, alongside v2 and device records", async () => {
    await saveNickname("household", "papa", "Papa Bear");
    const phrase = generateRecoveryPhrase();
    addHistoryKeyVersion(phrase, [setupPhone]);
    await saveNickname("household", "gran", "Grandma");
    addHistoryKeyVersion(phrase, [setupPhone]);
    await saveNickname("household", "mum", "Mama");
    failWrite = () => true;

    expect(await readAs(setupPhone, "household")).toStrictEqual({
      papa: "Papa Bear",
      gran: "Grandma",
      mum: "Mama",
    });
    expect(
      [...(nicknames.get("household")?.values() ?? [])].map(getPersonalDataHistoryKeyVersion),
    ).toStrictEqual([null, 1, 2]);
  });

  test("a version this phone doesn't hold is unreadable without breaking the rest", async () => {
    const phrase = generateRecoveryPhrase();
    const enrolled = createPhone("enrolled");
    await saveNickname("household", "papa", "Papa Bear");
    addHistoryKeyVersion(phrase, [setupPhone, enrolled]);
    addHistoryKeyVersion(phrase, [enrolled]);
    phone = enrolled;
    await saveNickname("household", "gran", "Grandma");
    await saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[4] });
    colors.set("broken", "not an envelope");
    nicknames.get("household")?.set("broken", '{"version":9}');

    expect(await readAs(setupPhone, "household")).toStrictEqual({
      broken: null,
      papa: "Papa Bear",
      gran: null,
    });
    await syncGroupColors(userId);
    expect(getGroupColor("household")).toBe(GROUP_COLOR_PALETTE[0]);
  });

  test("a relabelled history key version doesn't open", async () => {
    const phrase = generateRecoveryPhrase();
    addHistoryKeyVersion(phrase, [setupPhone]);
    await saveNickname("household", "gran", "Grandma");
    addHistoryKeyVersion(phrase, [setupPhone]);
    const household = nicknames.get("household") as Map<string, string>;
    const relabelled = { ...JSON.parse(household.get("gran") as string), historyKeyVersion: 2 };
    household.set("gran", JSON.stringify(relabelled));

    expect(await readAs(setupPhone, "household")).toStrictEqual({ gran: null });
    expect(writes()).toBe(1);
  });
});

describe("migration", () => {
  test("readable v2 records are re-sealed to the current version once", async () => {
    await writeV2Records();
    const before = writes();
    addHistoryKeyVersion(generateRecoveryPhrase(), [setupPhone]);

    await resealPersonalData(userId);

    expect(versionsOnServer()).toStrictEqual([1, 1, 1, 1, 1]);
    expect(writes() - before).toBe(5);
    for (const [input] of updateColorMock.mock.calls.slice(2)) {
      expect(input.expectedCiphertext).toBeDefined();
    }
    const secondPhone = createPhone("handset-d");
    secondPhone.secureStore = new Map(setupPhone.secureStore);
    expect(await readAs(secondPhone, "household")).toStrictEqual({
      papa: "Papa Bear",
      gran: "Grandma",
    });
    await syncGroupColors(userId);
    expect(getGroupColor("friends")).toBe(GROUP_COLOR_PALETTE[5]);

    const afterFirstRun = writes();
    phone = setupPhone;
    await resealPersonalData(userId);
    expect(writes()).toBe(afterFirstRun);
  });

  test("a failure part-way leaves the rest for the next run", async () => {
    await writeV2Records();
    addHistoryKeyVersion(generateRecoveryPhrase(), [setupPhone]);
    failWrite = (input) =>
      input.memberId === "gran" || (input.groupId === "household" && input.memberId === undefined);

    await resealPersonalData(userId);
    expect(versionsOnServer()).toStrictEqual([null, 1, null, 1, 1]);

    failWrite = null;
    const before = writes();
    await resealPersonalData(userId);
    expect(writes() - before).toBe(2);
    expect(versionsOnServer()).toStrictEqual([1, 1, 1, 1, 1]);
  });

  test("records this phone can't open are left alone", async () => {
    await writeV2Records();
    const otherPhone = createPhone("handset-b");
    addHistoryKeyVersion(generateRecoveryPhrase(), [otherPhone]);
    const snapshot = JSON.stringify([[...colors], [...nicknames].map(([id, g]) => [id, [...g]])]);
    phone = otherPhone;

    await resealPersonalData(userId);
    expect(await readAs(otherPhone, "household")).toStrictEqual({ papa: null, gran: null });

    expect(writes()).toBe(5);
    expect(JSON.stringify([[...colors], [...nicknames].map(([id, g]) => [id, [...g]])])).toBe(
      snapshot,
    );
  });

  test("a newer value written by another phone mid-migration is never replaced", async () => {
    await writeV2Records();
    addHistoryKeyVersion(generateRecoveryPhrase(), [setupPhone]);
    const newerColor = await sealForSelf({
      userId,
      purpose: "group-color",
      binding: [userId, "household"],
      plaintext: GROUP_COLOR_PALETTE[8],
    });
    const newerNickname = await encryptPersonalNickname({
      groupId: "household",
      memberId: "gran",
      userId,
      nickname: "Nana",
    });
    beforeWrite = (input) => {
      if (input.groupId !== "household") return;
      if (input.memberId === undefined) colors.set("household", newerColor);
      if (input.memberId === "gran") nicknames.get("household")?.set("gran", newerNickname);
    };

    await resealPersonalData(userId);

    beforeWrite = null;
    expect(colors.get("household")).toBe(newerColor);
    expect(nicknames.get("household")?.get("gran")).toBe(newerNickname);
    await syncGroupColors(userId);
    expect(getGroupColor("household")).toBe(GROUP_COLOR_PALETTE[8]);
    expect(await readAs(setupPhone, "household")).toStrictEqual({
      papa: "Papa Bear",
      gran: "Nana",
    });
  });

  test("loading nicknames returns the re-sealed ciphertext so edits don't conflict", async () => {
    await saveNickname("household", "gran", "Grandma");
    addHistoryKeyVersion(generateRecoveryPhrase(), [setupPhone]);

    const loaded = await loadPersonalNicknames("household", userId);

    expect(loaded["gran"]?.ciphertext).toBe(nicknames.get("household")?.get("gran") as string);
    expect(getPersonalDataHistoryKeyVersion(loaded["gran"]?.ciphertext ?? "")).toBe(1);
    await saveNickname("household", "gran", "Nana");
    expect(await readAs(setupPhone, "household")).toStrictEqual({ gran: "Nana" });
  });

  test("after a reset, a phone holding the old key moves old-version records to the new one", async () => {
    addHistoryKeyVersion(generateRecoveryPhrase(), [setupPhone]);
    await saveNickname("household", "gran", "Grandma");
    await saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[6] });
    colors.set(
      "friends",
      sealPersonalDataForHistoryKey({
        historyKey: { publicKey: createHistoryKeyPair().publicKey, version: 1 },
        purpose: "group-color",
        binding: [userId, "friends"],
        plaintext: GROUP_COLOR_PALETTE[7],
      }),
    );
    const unreadable = colors.get("friends");

    const newPhrase = generateRecoveryPhrase();
    expect((await resetRecoveryPhrase(newPhrase)).status).toBe("reset");
    await resealPersonalData(userId);
    expect(versionsOnServer()).toStrictEqual([2, 1, 2]);
    expect(colors.get("friends")).toBe(unreadable as string);

    const freshPhone = createPhone("handset-c");
    phone = freshPhone;
    await restoreFromRecoveryPhrase(newPhrase);
    expect(await readAs(freshPhone, "household")).toStrictEqual({ gran: "Grandma" });
    await syncGroupColors(userId);
    expect(getGroupColor("household")).toBe(GROUP_COLOR_PALETTE[6]);
    expect(getGroupColor("friends")).toBe(GROUP_COLOR_PALETTE[0]);
  });
});

describe("end to end", () => {
  test("the setup phone migrates, then a fresh phone restores the phrase and reads every record", async () => {
    await writeV2Records();
    const phrase = generateRecoveryPhrase();
    const setup = await setUpRecoveryPhrase(phrase);
    expect(setup.status).toBe("created");
    await resealPersonalData(userId);

    const freshPhone = createPhone("handset-c");
    phone = freshPhone;
    expect(await readAs(freshPhone, "household")).toStrictEqual({ papa: null, gran: null });
    await restoreFromRecoveryPhrase(phrase);
    await resealPersonalData(userId);

    expect(await readAs(freshPhone, "household")).toStrictEqual({
      papa: "Papa Bear",
      gran: "Grandma",
    });
    expect(await readAs(freshPhone, "friends")).toStrictEqual({ sam: "Sammy" });
    expect(getGroupColor("household")).toBe(GROUP_COLOR_PALETTE[3]);
    expect(getGroupColor("friends")).toBe(GROUP_COLOR_PALETTE[5]);
  });
});

describe("secrets", () => {
  test("sealing and migration send no plaintext, key bytes or phrase words", async () => {
    await writeV2Records();
    const phrase = generateRecoveryPhrase();
    await setUpRecoveryPhrase(phrase);
    await resealPersonalData(userId);
    await saveNickname("friends", "alex", "Captain Alex");
    await saveGroupColor({ userId, groupId: "household", color: GROUP_COLOR_PALETTE[7] });
    const freshPhone = createPhone("handset-c");
    phone = freshPhone;
    await restoreFromRecoveryPhrase(phrase);
    await resealPersonalData(userId);

    const serialized = JSON.stringify(serverInputs);
    for (const plaintext of [
      "Grandma",
      "Papa Bear",
      "Sammy",
      "Captain Alex",
      ...GROUP_COLOR_PALETTE,
      ...GROUP_COLOR_PALETTE.map((color) => color.slice(1)),
    ]) {
      expect(serialized).not.toContain(plaintext);
    }
    const secrets = [
      (setupPhone.secureStore.get(`${userId}.1`) as HistoryPrivateKeyMaterial).expose(),
      setupPhone.device.privateKey.expose(),
      freshPhone.device.privateKey.expose(),
      deriveRecoveryKeyPair(phrase).privateKey.expose(),
    ];
    expectNoSecretsIn(serialized, { secrets, phrases: [phrase] });
  });
});
