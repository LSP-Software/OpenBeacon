import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  deriveRecoveryKeyPair,
  encodeBase64,
  generateRecoveryPhrase,
  type HistoryKeyEscrow,
  type HistoryPrivateKeyMaterial,
  openHistoryKeyEscrow,
  type RecoveryPhrase,
  sealHistoryKeyEscrow,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { holdRowLock } from "../lib/databaseLocks.testUtil.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountRecoveryRouter } from "./accountRecoveryRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({ accountRecovery: accountRecoveryRouter });
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const prefix = `recovery-${crypto.randomUUID()}`;
const users = [
  "setup",
  "race",
  "strict",
  "change",
  "reset",
  "stale",
  "staleSetup",
  "unset",
  "keyOwner",
  "setupClash",
  "resetClash",
].map((name) => `${prefix}-${name}`);
const [
  setupUser,
  raceUser,
  strictUser,
  changeUser,
  resetUser,
  staleUser,
  staleSetupUser,
  unsetUser,
  keyOwnerUser,
  setupClashUser,
  resetClashUser,
] = users as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const groupId = `${prefix}-group`;
const staleSessionCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const caller = (userId: string, sessionCreatedAt = new Date()) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: {
      user: { id: userId },
      session: { id: `${userId}-session`, createdAt: sessionCreatedAt },
    },
  } as Parameters<typeof router.createCaller>[0]);

const recoveryKeyInput = (phrase: RecoveryPhrase) => {
  const { algorithm, derivationVersion, publicKey } = deriveRecoveryKeyPair(phrase);
  return { algorithm, derivationVersion, publicKey };
};

const newHistoryKey = ({
  phrase,
  userId,
  version,
}: {
  phrase: RecoveryPhrase;
  userId: string;
  version: number;
}) => {
  const historyKey = createHistoryKeyPair();
  return {
    input: {
      algorithm: historyKey.algorithm,
      escrow: sealHistoryKeyEscrow({
        historyPrivateKey: historyKey.privateKey,
        recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
        userId,
        version,
      }),
      id: crypto.randomUUID(),
      publicKey: historyKey.publicKey,
      version,
    },
    privateKey: historyKey.privateKey,
  };
};

const restoreHistoryKeys = async (userId: string, phrase: RecoveryPhrase) => {
  const recoveryPrivateKey = deriveRecoveryKeyPair(phrase).privateKey;
  return (await caller(userId).accountRecovery.escrows()).map((historyKey) =>
    openHistoryKeyEscrow({
      escrow: historyKey.escrow as HistoryKeyEscrow,
      historyKey,
      recoveryPrivateKey,
    }).expose(),
  );
};

const insertHistoryKey = async ({
  phrase,
  userId,
  version,
}: {
  phrase: RecoveryPhrase;
  userId: string;
  version: number;
}) => {
  const { input, privateKey } = newHistoryKey({ phrase, userId, version });
  await prisma.accountHistoryKey.create({
    data: {
      algorithm: input.algorithm,
      escrowAlgorithm: input.escrow.algorithm,
      escrowCiphertext: input.escrow.ciphertext,
      escrowEnc: input.escrow.enc,
      id: input.id,
      publicKey: input.publicKey,
      userId,
      version,
    },
  });
  return { id: input.id, privateKey, publicKey: input.publicKey };
};

const exposeAll = (keys: HistoryPrivateKeyMaterial[]) => keys.map((key) => key.expose());

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "account recovery with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("setup stores only public keys and an escrow the phrase can open", async () => {
      const phrase = generateRecoveryPhrase();
      const recoveryKey = deriveRecoveryKeyPair(phrase);
      const historyKey = newHistoryKey({ phrase, userId: setupUser, version: 1 });
      const account = caller(setupUser);

      expect(await account.accountRecovery.status()).toEqual({
        currentHistoryKey: null,
        historyKeyVersions: [],
        recoveryKey: null,
        sessionFresh: true,
      });
      await account.accountRecovery.setup({
        historyKey: historyKey.input,
        recoveryKey: recoveryKeyInput(phrase),
      });

      expect(await account.accountRecovery.status()).toEqual({
        currentHistoryKey: {
          id: historyKey.input.id,
          publicKey: historyKey.input.publicKey,
          version: 1,
        },
        historyKeyVersions: [1],
        recoveryKey: {
          algorithm: "X25519",
          derivationVersion: 1,
          publicKey: recoveryKey.publicKey,
        },
        sessionFresh: true,
      });
      expect(await restoreHistoryKeys(setupUser, phrase)).toEqual([historyKey.privateKey.expose()]);
      expect(() =>
        openHistoryKeyEscrow({
          escrow: historyKey.input.escrow,
          historyKey: { ...historyKey.input, userId: setupUser },
          recoveryPrivateKey: deriveRecoveryKeyPair(generateRecoveryPhrase()).privateKey,
        }),
      ).toThrow();

      const stored = JSON.stringify([
        await prisma.recoveryKey.findMany({ where: { userId: setupUser } }),
        await prisma.accountHistoryKey.findMany({ where: { userId: setupUser } }),
      ]);
      for (const secret of [
        recoveryKey.privateKey.expose(),
        historyKey.privateKey.expose(),
        new TextEncoder().encode(phrase.words().join(" ")),
      ]) {
        expect(stored).not.toContain(encodeBase64(secret));
        expect(stored).not.toContain(Buffer.from(secret).toString("hex"));
      }
      for (const word of phrase.words()) {
        expect(stored).not.toContain(`"${word}"`);
      }
    });

    test("concurrent setup calls create one recovery key and the other gets CONFLICT", async () => {
      const attempts = [generateRecoveryPhrase(), generateRecoveryPhrase()].map((phrase) => ({
        historyKey: newHistoryKey({ phrase, userId: raceUser, version: 1 }).input,
        recoveryKey: recoveryKeyInput(phrase),
      }));
      const lock = await holdRowLock({ db: prisma, id: raceUser, table: "User" });
      const pending = attempts.map((attempt) => caller(raceUser).accountRecovery.setup(attempt));
      await lock.waitForWaiters(2);
      await lock.release();
      const results = await Promise.allSettled(pending);

      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });
      const winner = attempts[results.findIndex(({ status }) => status === "fulfilled")]!;
      expect(await prisma.recoveryKey.findMany({ where: { userId: raceUser } })).toMatchObject([
        { publicKey: winner.recoveryKey.publicKey },
      ]);
      expect(
        await prisma.accountHistoryKey.findMany({ where: { userId: raceUser } }),
      ).toMatchObject([{ id: winner.historyKey.id, version: 1 }]);
    });

    test("setup rejects private key material, malformed escrows and non-v1 history keys", async () => {
      const phrase = generateRecoveryPhrase();
      const recoveryKey = deriveRecoveryKeyPair(phrase);
      const historyKey = newHistoryKey({ phrase, userId: strictUser, version: 1 });
      const input = { historyKey: historyKey.input, recoveryKey: recoveryKeyInput(phrase) };
      const account = caller(strictUser);
      const privateHistoryKey = encodeBase64(historyKey.privateKey.expose());

      for (const invalid of [
        {
          ...input,
          recoveryKey: {
            ...input.recoveryKey,
            privateKey: encodeBase64(recoveryKey.privateKey.expose()),
          },
        },
        { ...input, historyKey: { ...input.historyKey, privateKey: privateHistoryKey } },
        {
          ...input,
          historyKey: {
            ...input.historyKey,
            escrow: { ...input.historyKey.escrow, ciphertext: privateHistoryKey },
          },
        },
        { ...input, phrase: phrase.words().join(" ") },
        { ...input, historyKey: { ...input.historyKey, id: privateHistoryKey } },
        {
          ...input,
          historyKey: { ...input.historyKey, publicKey: encodeBase64(new Uint8Array(32)) },
        },
        { ...input, historyKey: newHistoryKey({ phrase, userId: strictUser, version: 2 }).input },
      ]) {
        await expect(
          account.accountRecovery.setup(
            invalid as Parameters<typeof account.accountRecovery.setup>[0],
          ),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      expect(await prisma.recoveryKey.count({ where: { userId: strictUser } })).toBe(0);
      expect(await prisma.accountHistoryKey.count({ where: { userId: strictUser } })).toBe(0);
    });

    test("changePhrase needs a fresh session and re-seals exactly the existing versions", async () => {
      const oldPhrase = generateRecoveryPhrase();
      const first = newHistoryKey({ phrase: oldPhrase, userId: changeUser, version: 1 });
      await caller(changeUser).accountRecovery.setup({
        historyKey: first.input,
        recoveryKey: recoveryKeyInput(oldPhrase),
      });
      const second = await insertHistoryKey({ phrase: oldPhrase, userId: changeUser, version: 2 });
      const newPhrase = generateRecoveryPhrase();
      const newRecoveryKey = recoveryKeyInput(newPhrase);
      const escrowFor = (privateKey: HistoryPrivateKeyMaterial, version: number) => ({
        ...sealHistoryKeyEscrow({
          historyPrivateKey: privateKey,
          recoveryPrivateKey: deriveRecoveryKeyPair(newPhrase).privateKey,
          userId: changeUser,
          version,
        }),
        version,
      });
      const escrows = [escrowFor(first.privateKey, 1), escrowFor(second.privateKey, 2)];

      await expect(
        caller(changeUser, staleSessionCreatedAt).accountRecovery.changePhrase({
          escrows,
          recoveryKey: newRecoveryKey,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (const invalid of [
        [escrows[0]!],
        [...escrows, escrowFor(second.privateKey, 3)],
        [escrows[0]!, escrows[0]!],
        [...escrows, escrows[1]!],
        [escrows[0]!, escrowFor(second.privateKey, 3)],
      ]) {
        await expect(
          caller(changeUser).accountRecovery.changePhrase({
            escrows: invalid,
            recoveryKey: newRecoveryKey,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      }
      expect(await restoreHistoryKeys(changeUser, oldPhrase)).toEqual(
        exposeAll([first.privateKey, second.privateKey]),
      );

      await caller(changeUser).accountRecovery.changePhrase({
        escrows,
        recoveryKey: newRecoveryKey,
      });
      expect((await caller(changeUser).accountRecovery.status()).recoveryKey?.publicKey).toBe(
        newRecoveryKey.publicKey,
      );
      expect(await restoreHistoryKeys(changeUser, newPhrase)).toEqual(
        exposeAll([first.privateKey, second.privateKey]),
      );
      await expect(restoreHistoryKeys(changeUser, oldPhrase)).rejects.toThrow();
      expect(
        (await prisma.accountHistoryKey.findMany({ where: { userId: changeUser } })).map(
          ({ id }) => id,
        ),
      ).toEqual(expect.arrayContaining([first.input.id, second.id]));
    }, 20_000);

    test("reset needs a fresh session and confirmation, then replaces every key with v(N+1)", async () => {
      const oldPhrase = generateRecoveryPhrase();
      const first = newHistoryKey({ phrase: oldPhrase, userId: resetUser, version: 1 });
      const newPhrase = generateRecoveryPhrase();
      await expect(
        caller(resetUser).accountRecovery.reset({
          confirmReset: true,
          historyKey: newHistoryKey({ phrase: newPhrase, userId: resetUser, version: 1 }).input,
          recoveryKey: recoveryKeyInput(newPhrase),
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await caller(resetUser).accountRecovery.setup({
        historyKey: first.input,
        recoveryKey: recoveryKeyInput(oldPhrase),
      });
      const second = await insertHistoryKey({ phrase: oldPhrase, userId: resetUser, version: 2 });

      const device = createDeviceKeyPair();
      await prisma.userDevice.create({
        data: {
          id: `${prefix}-device`,
          publicKey: device.publicKey,
          publicKeyAlgorithm: device.algorithm,
          userId: resetUser,
        },
      });
      const epoch = createInitialGroupEpoch({
        creator: { deviceId: `${prefix}-device`, privateKey: device.privateKey },
        groupId,
        recipients: [],
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Group",
          groupMembers: { create: { userId: resetUser, role: "OWNER", joinedEpochNumber: 1 } },
          groupEpochs: {
            create: { id: epoch.epoch.epochId, epochNumber: 1, senderPublicKey: device.publicKey },
          },
        },
      });
      const wrap = wrapEpochKeyForHistoryKey({
        epochId: epoch.epoch.epochId,
        epochKey: epoch.epochKey,
        historyKey: { publicKey: second.publicKey, userId: resetUser, version: 2 },
        senderPrivateKey: device.privateKey,
      });
      await prisma.groupEpochHistoryWrap.create({
        data: {
          algorithm: wrap.algorithm,
          ephemeralPublicKey: wrap.ephemeralPublicKey,
          groupEpochId: epoch.epoch.epochId,
          historyKeyId: second.id,
          senderPublicKey: wrap.senderPublicKey,
          wrappedKey: wrap.wrappedKey,
        },
      });

      const replacement = newHistoryKey({ phrase: newPhrase, userId: resetUser, version: 3 });
      const resetInput = {
        confirmReset: true as const,
        historyKey: replacement.input,
        recoveryKey: recoveryKeyInput(newPhrase),
      };
      await expect(
        caller(resetUser, staleSessionCreatedAt).accountRecovery.reset(resetInput),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(resetUser).accountRecovery.reset({
          ...resetInput,
          confirmReset: false,
        } as unknown as typeof resetInput),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      for (const version of [2, 4]) {
        await expect(
          caller(resetUser).accountRecovery.reset({
            ...resetInput,
            historyKey: newHistoryKey({ phrase: newPhrase, userId: resetUser, version }).input,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      }
      expect(await prisma.accountHistoryKey.count({ where: { userId: resetUser } })).toBe(2);
      expect(await prisma.groupEpochHistoryWrap.count({ where: { historyKeyId: second.id } })).toBe(
        1,
      );

      await caller(resetUser).accountRecovery.reset(resetInput);
      expect(await caller(resetUser).accountRecovery.status()).toMatchObject({
        currentHistoryKey: { id: replacement.input.id, version: 3 },
        historyKeyVersions: [3],
        recoveryKey: { publicKey: resetInput.recoveryKey.publicKey },
      });
      expect(
        await prisma.groupEpochHistoryWrap.count({ where: { groupEpochId: epoch.epoch.epochId } }),
      ).toBe(0);
      expect(await restoreHistoryKeys(resetUser, newPhrase)).toEqual([
        replacement.privateKey.expose(),
      ]);
      await expect(restoreHistoryKeys(resetUser, oldPhrase)).rejects.toThrow();
    }, 20_000);

    test("a session older than the better-auth fresh age cannot set up a phrase and status reports it", async () => {
      const phrase = generateRecoveryPhrase();
      const stale = caller(staleSetupUser, staleSessionCreatedAt);
      await expect(
        stale.accountRecovery.setup({
          historyKey: newHistoryKey({ phrase, userId: staleSetupUser, version: 1 }).input,
          recoveryKey: recoveryKeyInput(phrase),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Sign in again to continue." });
      expect(await stale.accountRecovery.status()).toMatchObject({
        recoveryKey: null,
        sessionFresh: false,
      });
      expect(await prisma.recoveryKey.count({ where: { userId: staleSetupUser } })).toBe(0);
      expect(await prisma.accountHistoryKey.count({ where: { userId: staleSetupUser } })).toBe(0);
    });

    test("a session older than the better-auth fresh age cannot change or reset the phrase", async () => {
      const phrase = generateRecoveryPhrase();
      const historyKey = newHistoryKey({ phrase, userId: staleUser, version: 1 });
      await caller(staleUser).accountRecovery.setup({
        historyKey: historyKey.input,
        recoveryKey: recoveryKeyInput(phrase),
      });
      const nearlyStale = new Date(Date.now() - 23 * 60 * 60 * 1000);
      await caller(staleUser, nearlyStale).accountRecovery.changePhrase({
        escrows: [{ ...historyKey.input.escrow, version: 1 }],
        recoveryKey: recoveryKeyInput(phrase),
      });
      await expect(
        caller(staleUser, new Date(Date.now() - 25 * 60 * 60 * 1000)).accountRecovery.reset({
          confirmReset: true,
          historyKey: newHistoryKey({ phrase, userId: staleUser, version: 2 }).input,
          recoveryKey: recoveryKeyInput(phrase),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Sign in again to continue." });
      expect(
        await prisma.accountHistoryKey.findMany({ where: { userId: staleUser } }),
      ).toMatchObject([{ id: historyKey.input.id, version: 1 }]);
    }, 20_000);

    test("changePhrase is NOT_FOUND when no recovery phrase is set up", async () => {
      const phrase = generateRecoveryPhrase();
      const { escrow } = newHistoryKey({ phrase, userId: unsetUser, version: 1 }).input;
      await expect(
        caller(unsetUser).accountRecovery.changePhrase({
          escrows: [{ ...escrow, version: 1 }],
          recoveryKey: recoveryKeyInput(phrase),
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await prisma.recoveryKey.count({ where: { userId: unsetUser } })).toBe(0);
    });

    test("setup and reset reject a history key id that another user already holds", async () => {
      const taken = await insertHistoryKey({
        phrase: generateRecoveryPhrase(),
        userId: keyOwnerUser,
        version: 1,
      });
      const conflict = {
        code: "CONFLICT",
        message: "That history key ID is already in use.",
      };
      const setupPhrase = generateRecoveryPhrase();
      await expect(
        caller(setupClashUser).accountRecovery.setup({
          historyKey: {
            ...newHistoryKey({ phrase: setupPhrase, userId: setupClashUser, version: 1 }).input,
            id: taken.id,
          },
          recoveryKey: recoveryKeyInput(setupPhrase),
        }),
      ).rejects.toMatchObject(conflict);
      expect(await prisma.recoveryKey.count({ where: { userId: setupClashUser } })).toBe(0);
      expect(await prisma.accountHistoryKey.count({ where: { userId: setupClashUser } })).toBe(0);

      const resetPhrase = generateRecoveryPhrase();
      const first = newHistoryKey({ phrase: resetPhrase, userId: resetClashUser, version: 1 });
      await caller(resetClashUser).accountRecovery.setup({
        historyKey: first.input,
        recoveryKey: recoveryKeyInput(resetPhrase),
      });
      const newPhrase = generateRecoveryPhrase();
      await expect(
        caller(resetClashUser).accountRecovery.reset({
          confirmReset: true,
          historyKey: {
            ...newHistoryKey({ phrase: newPhrase, userId: resetClashUser, version: 2 }).input,
            id: taken.id,
          },
          recoveryKey: recoveryKeyInput(newPhrase),
        }),
      ).rejects.toMatchObject(conflict);
      expect(
        await prisma.accountHistoryKey.findMany({ where: { userId: resetClashUser } }),
      ).toMatchObject([{ id: first.input.id, version: 1 }]);
      expect(
        (await prisma.recoveryKey.findUniqueOrThrow({ where: { userId: resetClashUser } }))
          .publicKey,
      ).toBe(recoveryKeyInput(resetPhrase).publicKey);
    });
  },
);
