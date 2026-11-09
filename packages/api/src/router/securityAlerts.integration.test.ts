import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { auth, createSecurityAlerts } from "@openbeacon/auth";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { type Prisma, prisma } from "@openbeacon/database";
import type { SecurityAlert } from "@openbeacon/email";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  deriveRecoveryKeyPair,
  generateRecoveryPhrase,
  sealHistoryKeyEscrow,
} from "@openbeacon/encryption";
import { deleteAccountRecords } from "../lib/account-deletion.ts";
import { upsertUserDevice } from "../lib/groupEpochs.ts";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const prefix = `alerts-${crypto.randomUUID()}`;
const password = "testing-password-123";
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const sent: {
  to: string;
  userId: string;
  alert: SecurityAlert;
  timezone: string | null;
  hasPassword: boolean;
}[] = [];
let sendFailure: Error | null = null;
let sendGate: Promise<void> | null = null;
const tasks: Promise<unknown>[] = [];
const securityAlerts = createSecurityAlerts({
  db: prisma,
  sendSecurityAlertEmail: async ({ to, userId, alert, timezone, hasPassword }) => {
    if (sendFailure) throw sendFailure;
    await sendGate;
    sent.push({ to, userId, alert, timezone, hasPassword });
  },
  runInBackground: (task) => tasks.push(task),
});
const sentAlerts = async () => {
  await Promise.all(tasks.splice(0));
  return sent;
};

let accountCounter = 0;
const createAccount = async () => {
  accountCounter += 1;
  const email = `${prefix}-${accountCounter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Alert Test" } });
  const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  const caller = appRouter.createCaller({
    cache,
    db: prisma,
    emailCodes: null,
    securityAlerts,
    clientIp: `ip-${user.id}`,
    session: { user: { id: user.id }, session: { id: session.id, createdAt: new Date() } },
  } as Parameters<typeof appRouter.createCaller>[0]);
  return { caller, email, userId: user.id };
};

const registerDevice = (
  { caller, userId }: Awaited<ReturnType<typeof createAccount>>,
  details: { platform?: "android" | "ios"; model?: string } = {},
) =>
  caller.auth.registerDeviceKey({
    algorithm: DEVICE_KEY_ALGORITHM,
    deviceId: `${userId}-${crypto.randomUUID()}`,
    publicKey: createDeviceKeyPair().publicKey,
    expectedUserId: userId,
    ...details,
  });

const historyKeyInput = (phrase: ReturnType<typeof generateRecoveryPhrase>, userId: string) => {
  const historyKey = createHistoryKeyPair();
  return {
    algorithm: historyKey.algorithm,
    escrow: sealHistoryKeyEscrow({
      historyPrivateKey: historyKey.privateKey,
      recoveryPrivateKey: deriveRecoveryKeyPair(phrase).privateKey,
      userId,
      version: 1,
    }),
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
    version: 1,
  };
};

const recoveryKeyInput = (phrase: ReturnType<typeof generateRecoveryPhrase>) => {
  const { algorithm, derivationVersion, publicKey } = deriveRecoveryKeyPair(phrase);
  return { algorithm, derivationVersion, publicKey };
};

const setUpRecovery = async ({ caller, userId }: Awaited<ReturnType<typeof createAccount>>) => {
  const phrase = generateRecoveryPhrase();
  const historyKey = historyKeyInput(phrase, userId);
  await caller.accountRecovery.setup({ historyKey, recoveryKey: recoveryKeyInput(phrase) });
  return historyKey;
};

const changePhrase = async (account: Awaited<ReturnType<typeof createAccount>>) => {
  const historyKey = await setUpRecovery(account);
  await sentAlerts();
  sent.length = 0;
  const phrase = generateRecoveryPhrase();
  return account.caller.accountRecovery.changePhrase({
    escrows: [{ ...historyKeyInput(phrase, account.userId).escrow, version: historyKey.version }],
    recoveryKey: recoveryKeyInput(phrase),
  });
};

const turnOffOptionalAlerts = (userId: string) =>
  prisma.user.update({
    where: { id: userId },
    data: { alertNewDevice: false, alertDeletionScheduled: false },
  });

beforeEach(async () => {
  await sentAlerts();
  sent.length = 0;
  sendFailure = null;
  sendGate = null;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("security alerts", () => {
  test("changing the recovery phrase sends one alert, even with optional alerts off", async () => {
    const account = await createAccount();
    await turnOffOptionalAlerts(account.userId);

    await changePhrase(account);

    expect(await sentAlerts()).toEqual([
      {
        to: account.email,
        userId: account.userId,
        alert: { type: "recovery-phrase-changed" },
        timezone: null,
        hasPassword: true,
      },
    ]);
  });

  test("resetting the recovery phrase sends one alert, even with optional alerts off", async () => {
    const account = await createAccount();
    await turnOffOptionalAlerts(account.userId);
    await setUpRecovery(account);
    await sentAlerts();
    sent.length = 0;
    const phrase = generateRecoveryPhrase();

    await account.caller.accountRecovery.reset({
      confirmReset: true,
      historyKey: { ...historyKeyInput(phrase, account.userId), version: 2 },
      recoveryKey: recoveryKeyInput(phrase),
    });

    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "recovery-phrase-reset" },
    ]);
  });

  test("a failed recovery phrase change sends no alert", async () => {
    const account = await createAccount();
    const phrase = generateRecoveryPhrase();

    await expect(
      account.caller.accountRecovery.changePhrase({
        escrows: [{ ...historyKeyInput(phrase, account.userId).escrow, version: 1 }],
        recoveryKey: recoveryKeyInput(phrase),
      }),
    ).rejects.toThrow("No recovery phrase is set up.");
    expect(await sentAlerts()).toEqual([]);
  });

  test("the first device sends no alert and each later new device sends one", async () => {
    const account = await createAccount();

    await registerDevice(account, { platform: "android", model: "Pixel 8" });
    expect(await sentAlerts()).toEqual([]);

    await registerDevice(account, { platform: "ios", model: "iPhone 15" });
    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "new-device", device: { model: "iPhone 15", platform: "ios" } },
    ]);
  });

  test("a second device registered while the first is still saving sends one alert", async () => {
    const account = await createAccount();
    const firstSaved = Promise.withResolvers<void>();
    const secondWaiting = Promise.withResolvers<void>();
    const register = (
      platform: "android" | "ios",
      hooks: { beforeLock: () => void; afterCreate: () => Promise<void> },
    ) =>
      upsertUserDevice({
        db: {
          userDevice: prisma.userDevice,
          $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            prisma.$transaction((tx) =>
              callback({
                ...tx,
                $queryRaw: (...args: Parameters<typeof tx.$queryRaw>) => {
                  hooks.beforeLock();
                  return tx.$queryRaw(...args);
                },
                group: tx.group,
                userDevice: {
                  count: (args: Parameters<typeof tx.userDevice.count>[0]) =>
                    tx.userDevice.count(args),
                  create: async (args: Parameters<typeof tx.userDevice.create>[0]) => {
                    const device = await tx.userDevice.create(args);
                    await hooks.afterCreate();
                    return device;
                  },
                },
              } as unknown as Prisma.TransactionClient),
            ),
        } as unknown as Parameters<typeof upsertUserDevice>[0]["db"],
        input: {
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: `${account.userId}-${platform}`,
          publicKey: createDeviceKeyPair().publicKey,
          platform,
        },
        securityAlerts,
        userId: account.userId,
      });

    const first = register("android", {
      beforeLock: () => {},
      afterCreate: async () => {
        firstSaved.resolve();
        await secondWaiting.promise;
      },
    });
    await firstSaved.promise;
    const second = register("ios", {
      beforeLock: () => secondWaiting.resolve(),
      afterCreate: async () => secondWaiting.resolve(),
    });
    await Promise.all([first, second]);

    expect(await prisma.userDevice.count({ where: { userId: account.userId } })).toBe(2);
    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "new-device", device: { model: null, platform: "ios" } },
    ]);
  });

  test("registering the same device again sends no alert", async () => {
    const account = await createAccount();
    await registerDevice(account);
    const input = {
      algorithm: DEVICE_KEY_ALGORITHM,
      deviceId: `${account.userId}-second`,
      publicKey: createDeviceKeyPair().publicKey,
      expectedUserId: account.userId,
    };
    await account.caller.auth.registerDeviceKey(input);
    await sentAlerts();
    sent.length = 0;

    await account.caller.auth.registerDeviceKey(input);

    expect(await sentAlerts()).toEqual([]);
  });

  test("new device alerts can be turned off", async () => {
    const account = await createAccount();
    await registerDevice(account);
    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: false,
      alertDeletionScheduled: true,
    });
    await sentAlerts();
    sent.length = 0;

    await registerDevice(account);

    expect(await sentAlerts()).toEqual([]);
  });

  test("a new device's model and platform are stored, and unsafe model names are dropped", async () => {
    const account = await createAccount();
    await registerDevice(account);
    const stored = await registerDevice(account, {
      platform: "android",
      model: "Click https://example.test",
    });

    expect(await prisma.userDevice.findUniqueOrThrow({ where: { id: stored.id } })).toMatchObject({
      model: null,
      platform: "android",
    });
    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "new-device", device: { model: null, platform: "android" } },
    ]);
  });

  test("scheduling deletion sends one alert with the deletion date", async () => {
    const account = await createAccount();
    await account.caller.emailAlerts.setTimezone({ timezone: "Europe/London" });

    const { deletionDate } = await account.caller.account.requestDeletion({ password });

    expect(await sentAlerts()).toEqual([
      {
        to: account.email,
        userId: account.userId,
        alert: { type: "deletion-scheduled", deletionDate },
        timezone: "Europe/London",
        hasPassword: true,
      },
    ]);
  });

  test("deletion alerts can be turned off", async () => {
    const account = await createAccount();
    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: true,
      alertDeletionScheduled: false,
    });
    await sentAlerts();
    sent.length = 0;

    await account.caller.account.requestDeletion({ password });

    expect(await sentAlerts()).toEqual([]);
  });

  test("turning an alert off sends one alert naming it", async () => {
    const account = await createAccount();

    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: true,
      alertDeletionScheduled: false,
    });

    expect(await sentAlerts()).toEqual([
      {
        to: account.email,
        userId: account.userId,
        alert: { type: "alerts-turned-off", alerts: ["deletion-scheduled"] },
        timezone: null,
        hasPassword: true,
      },
    ]);
  });

  test("turning both alerts off at once sends one alert naming both", async () => {
    const account = await createAccount();

    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: false,
      alertDeletionScheduled: false,
    });

    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: ["new-device", "deletion-scheduled"] },
    ]);
  });

  test("turning alerts on or saving unchanged settings sends nothing", async () => {
    const account = await createAccount();
    await turnOffOptionalAlerts(account.userId);

    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: true,
      alertDeletionScheduled: false,
    });
    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: true,
      alertDeletionScheduled: false,
    });
    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: true,
      alertDeletionScheduled: true,
    });

    expect(await sentAlerts()).toEqual([]);
  });

  test("deleting an account immediately sends one alert to its address", async () => {
    const account = await createAccount();

    await account.caller.account.requestDeletion({ password, immediate: true });

    expect(await prisma.user.findUnique({ where: { id: account.userId } })).toBeNull();
    expect(await sentAlerts()).toEqual([
      {
        to: account.email,
        userId: account.userId,
        alert: { type: "account-deleted" },
        timezone: null,
        hasPassword: true,
      },
    ]);
  });

  test("a scheduled deletion sends the account deleted alert only when it runs", async () => {
    const account = await createAccount();
    await account.caller.account.requestDeletion({ password });
    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual(["deletion-scheduled"]);
    sent.length = 0;
    await prisma.$executeRaw`UPDATE "User" SET "deletionDate" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${account.userId}`;

    await deleteAccountRecords({
      db: prisma,
      userId: account.userId,
      imageUrlPrefix: "https://cdn.example/bucket",
      mode: "scheduled",
      securityAlerts,
    });

    expect((await sentAlerts()).map(({ to, alert }) => ({ to, alert }))).toEqual([
      { to: account.email, alert: { type: "account-deleted" } },
    ]);
  });

  test("an account without a password is flagged so the email can give Google advice", async () => {
    const user = await prisma.user.create({
      data: { id: `${prefix}-google`, email: `${prefix}-google@example.test`, name: "Google" },
    });
    await prisma.account.create({
      data: {
        id: `${prefix}-google-account`,
        userId: user.id,
        providerId: "google",
        accountId: `${prefix}-google`,
      },
    });

    securityAlerts.send(user.id, { type: "recovery-phrase-reset" });

    expect((await sentAlerts()).map(({ hasPassword }) => hasPassword)).toEqual([false]);
  });

  test("a stalled mail server doesn't hold up the request", async () => {
    const account = await createAccount();
    await registerDevice(account);
    const { promise, resolve } = Promise.withResolvers<void>();
    sendGate = promise;

    await registerDevice(account, { platform: "ios" });
    await account.caller.account.requestDeletion({ password });
    resolve();

    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual([
      "new-device",
      "deletion-scheduled",
    ]);
  });

  test("a failed send doesn't fail the request", async () => {
    const account = await createAccount();
    await registerDevice(account);
    sendFailure = new Error("SMTP is down");

    await changePhrase(account);
    const device = await registerDevice(account);
    await account.caller.account.requestDeletion({ password });

    expect(await prisma.userDevice.count({ where: { id: device.id } })).toBe(1);
    expect(
      await prisma.user.findUniqueOrThrow({
        select: { pendingDeletion: true },
        where: { id: account.userId },
      }),
    ).toEqual({ pendingDeletion: true });
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("email alert settings", () => {
  test("both optional alerts start on and can be changed", async () => {
    const account = await createAccount();

    expect(await account.caller.emailAlerts.settings()).toEqual({
      alertNewDevice: true,
      alertDeletionScheduled: true,
    });
    await account.caller.emailAlerts.updateSettings({
      alertNewDevice: false,
      alertDeletionScheduled: true,
    });
    expect(await account.caller.emailAlerts.settings()).toEqual({
      alertNewDevice: false,
      alertDeletionScheduled: true,
    });
  });

  test("an unknown timezone is rejected", async () => {
    const account = await createAccount();

    await expect(
      account.caller.emailAlerts.setTimezone({ timezone: "Mars/Olympus" }),
    ).rejects.toThrow("Unknown timezone.");
    expect(
      await prisma.user.findUniqueOrThrow({
        select: { timezone: true },
        where: { id: account.userId },
      }),
    ).toEqual({ timezone: null });
  });
});
