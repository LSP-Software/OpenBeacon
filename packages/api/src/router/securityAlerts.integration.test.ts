import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { auth, authCapabilities, createSecurityAlerts } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
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
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";

const prefix = `alerts-${crypto.randomUUID()}`;
const password = "testing-password-123";
const cache = createIntegrationTestCache(() => 0);
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
let clockOffset = 0;
const now = () => new Date(Date.now() + clockOffset);
const timers: { dueAt: number; run: () => void }[] = [];
const createAlerts = ({
  alertsTurnedOff = cache.alertsTurnedOff,
  withEmail = true,
  push = null,
}: {
  alertsTurnedOff?: typeof cache.alertsTurnedOff;
  withEmail?: boolean;
  push?: Parameters<typeof createSecurityAlerts>[0]["push"];
} = {}) =>
  createSecurityAlerts({
    db: prisma,
    sendSecurityAlertEmail: withEmail
      ? async ({ to, userId, alert, at, timezone, hasPassword }) => {
          if (sendFailure) throw sendFailure;
          await sendGate;
          sent.push({ to, userId, alert, timezone, hasPassword });
          sentAt.push(at);
        }
      : null,
    now,
    runInBackground: (task) => tasks.push(task),
    alertsTurnedOff,
    setTimer: (run, ms) => timers.push({ dueAt: now().getTime() + ms, run }),
    push,
  });
const sentAt: Date[] = [];
const securityAlerts = createAlerts();
const sentAlerts = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
  return sent;
};
const waitSeconds = async (seconds: number) => {
  await sentAlerts();
  clockOffset += seconds * 1000;
  const due = timers.filter(({ dueAt }) => dueAt <= now().getTime());
  due.forEach((timer) => {
    timers.splice(timers.indexOf(timer), 1);
    timer.run();
  });
  return sentAlerts();
};

const newSignInEmail = { type: "NEW_SIGN_IN", channel: "email" } as const;
const deletionScheduledEmail = { type: "DELETION_SCHEDULED", channel: "email" } as const;

let accountCounter = 0;
const createAccount = async () => {
  accountCounter += 1;
  const email = `${prefix}-${accountCounter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Alert Test" } });
  const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  const callerWith = (deviceId: string | null, sessionId = session.id) =>
    appRouter.createCaller(
      withDeviceActive({
        cache,
        db: prisma,
        emailCodes: null,
        securityAlerts,
        deviceId,
        session: {
          user: { id: user.id, email },
          session: { id: sessionId, createdAt: new Date() },
        },
      }) as Parameters<typeof appRouter.createCaller>[0],
    );
  const newPhoneCaller = async () => {
    const { token } = await auth.api.signInEmail({ body: { email, password } });
    const newSession = await prisma.session.findFirstOrThrow({ where: { token } });
    return callerWith(null, newSession.id);
  };
  const activeCaller = async () => {
    const device = await prisma.userDevice.create({
      data: {
        activatedAt: new Date(),
        icon: "phone",
        id: `${user.id}-${crypto.randomUUID()}`,
        name: "Phone",
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        userId: user.id,
      },
    });
    return callerWith(device.id);
  };
  return { activeCaller, caller: callerWith(null), email, newPhoneCaller, userId: user.id };
};

const registerDevice = async (
  { newPhoneCaller, userId }: Awaited<ReturnType<typeof createAccount>>,
  details: { platform?: "android" | "ios"; model?: string } = {},
) =>
  (await newPhoneCaller()).auth.registerDeviceKey({
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

const setUpRecovery = async ({
  activeCaller,
  userId,
}: Awaited<ReturnType<typeof createAccount>>) => {
  const phrase = generateRecoveryPhrase();
  const historyKey = historyKeyInput(phrase, userId);
  await prisma.accountHistoryKey.create({
    data: {
      algorithm: historyKey.algorithm,
      id: historyKey.id,
      publicKey: historyKey.publicKey,
      userId,
      version: historyKey.version,
    },
  });
  await (
    await activeCaller()
  ).accountRecovery.setup({
    escrows: [{ ...historyKey.escrow, version: historyKey.version }],
    recoveryKey: recoveryKeyInput(phrase),
  });
  return historyKey;
};

const changePhrase = async (account: Awaited<ReturnType<typeof createAccount>>) => {
  const historyKey = await setUpRecovery(account);
  await sentAlerts();
  sent.length = 0;
  const phrase = generateRecoveryPhrase();
  return (await account.activeCaller()).accountRecovery.changePhrase({
    escrows: [{ ...historyKeyInput(phrase, account.userId).escrow, version: historyKey.version }],
    recoveryKey: recoveryKeyInput(phrase),
  });
};

const turnOffOptionalAlerts = (userId: string) =>
  prisma.notificationSetting.createMany({
    data: (["NEW_SIGN_IN", "DELETION_SCHEDULED"] as const).map((type) => ({
      userId,
      type,
      email: false,
      phone: true,
    })),
  });

beforeEach(async () => {
  await waitSeconds(60);
  sent.length = 0;
  timers.length = 0;
  sendFailure = null;
  sendGate = null;
  sentAt.length = 0;
});

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
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

    await (
      await account.activeCaller()
    ).accountRecovery.reset({
      confirmReset: true,
      historyKey: { ...historyKeyInput(phrase, account.userId), version: 2 },
      recoveryKey: recoveryKeyInput(phrase),
    });

    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "recovery-phrase-reset" },
    ]);
  });

  test("a failed recovery phrase change or reset sends no alert", async () => {
    const account = await createAccount();
    const phrase = generateRecoveryPhrase();

    await expect(
      (await account.activeCaller()).accountRecovery.changePhrase({
        escrows: [{ ...historyKeyInput(phrase, account.userId).escrow, version: 1 }],
        recoveryKey: recoveryKeyInput(phrase),
      }),
    ).rejects.toThrow("No recovery phrase is set up.");
    await expect(
      (await account.activeCaller()).accountRecovery.reset({
        confirmReset: true,
        historyKey: { ...historyKeyInput(phrase, account.userId), version: 2 },
        recoveryKey: recoveryKeyInput(phrase),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await sentAlerts()).toEqual([]);
  });

  test("the first device sends no alert and each later Pending device sends one", async () => {
    const account = await createAccount();

    await registerDevice(account, { platform: "android", model: "Pixel 8" });
    expect(await sentAlerts()).toEqual([]);

    await registerDevice(account, { platform: "ios", model: "iPhone 15" });
    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "new-sign-in", device: { model: "iPhone 15", platform: "ios" } },
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
      { type: "new-sign-in", device: { model: null, platform: "ios" } },
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
    const secondPhone = await account.newPhoneCaller();
    await secondPhone.auth.registerDeviceKey(input);
    await sentAlerts();
    sent.length = 0;

    await secondPhone.auth.registerDeviceKey(input);

    expect(await sentAlerts()).toEqual([]);
  });

  test("new device alerts can be turned off", async () => {
    const account = await createAccount();
    await registerDevice(account);
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
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
      { type: "new-sign-in", device: { model: null, platform: "android" } },
    ]);
  });

  test("scheduling deletion sends one alert with the deletion date", async () => {
    const account = await createAccount();
    await (await account.activeCaller()).emailAlerts.setTimezone({ timezone: "Europe/London" });

    const { deletionDate } = await (
      await account.activeCaller()
    ).account.requestDeletion({ password });

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
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: true,
      alertDeletionScheduled: false,
    });
    await sentAlerts();
    sent.length = 0;

    await (await account.activeCaller()).account.requestDeletion({ password });

    expect(await sentAlerts()).toEqual([]);
  });

  test("turning an alert off sends one alert naming it a minute later", async () => {
    const account = await createAccount();
    const turnedOffAt = now();

    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: true,
      alertDeletionScheduled: false,
    });

    expect(await waitSeconds(59)).toEqual([]);
    expect(await waitSeconds(1)).toEqual([
      {
        to: account.email,
        userId: account.userId,
        alert: { type: "alerts-turned-off", alerts: [deletionScheduledEmail] },
        timezone: null,
        hasPassword: true,
      },
    ]);
    expect(Math.abs((sentAt[0]?.getTime() ?? 0) - turnedOffAt.getTime())).toBeLessThan(1000);
  });

  test("turning both alerts off at once sends one alert naming both", async () => {
    const account = await createAccount();

    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: false,
    });

    expect((await waitSeconds(60)).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail, deletionScheduledEmail] },
    ]);
  });

  test("turning alerts off one at a time within a minute sends one alert naming both", async () => {
    const account = await createAccount();
    const firstAt = now();

    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });
    await waitSeconds(30);
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: false,
    });

    expect(await waitSeconds(30)).toHaveLength(1);
    expect(await waitSeconds(60)).toHaveLength(1);
    expect(sent.map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail, deletionScheduledEmail] },
    ]);
    expect(Math.abs((sentAt[0]?.getTime() ?? 0) - firstAt.getTime())).toBeLessThan(1000);
  });

  test("turning an alert back on within the minute still sends the alert", async () => {
    const account = await createAccount();

    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });
    await waitSeconds(10);
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: true,
      alertDeletionScheduled: true,
    });

    expect((await waitSeconds(50)).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail] },
    ]);
  });

  test("an alert turned off after the batch was sent starts a new batch", async () => {
    const account = await createAccount();
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });
    await waitSeconds(60);
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: false,
    });

    expect((await waitSeconds(60)).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail] },
      { type: "alerts-turned-off", alerts: [deletionScheduledEmail] },
    ]);
  });

  test("a restarted server sends the alerts another server was holding", async () => {
    const account = await createAccount();
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: false,
    });
    await sentAlerts();
    timers.length = 0;
    await waitSeconds(30);

    createAlerts().schedulePendingAlertsTurnedOff();

    expect(await waitSeconds(29)).toEqual([]);
    expect((await waitSeconds(1)).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail, deletionScheduledEmail] },
    ]);
  });

  test("a server that starts after the minute is up sends the held alert straight away", async () => {
    const account = await createAccount();
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });
    await sentAlerts();
    timers.length = 0;
    await waitSeconds(300);

    createAlerts().schedulePendingAlertsTurnedOff();

    expect((await waitSeconds(0)).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail] },
    ]);
  });

  test("two servers holding the same alerts send it once", async () => {
    const account = await createAccount();
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: false,
    });
    await sentAlerts();
    createAlerts().schedulePendingAlertsTurnedOff();

    expect(await waitSeconds(60)).toHaveLength(1);
  });

  test("a failed alerts turned off email doesn't fail the request", async () => {
    const account = await createAccount();
    sendFailure = new Error("SMTP is down");

    expect(
      await (
        await account.activeCaller()
      ).emailAlerts.updateSettings({
        alertNewSignIn: false,
        alertDeletionScheduled: false,
      }),
    ).toEqual({ alertNewSignIn: false, alertDeletionScheduled: false });
    expect(await waitSeconds(60)).toEqual([]);
  });

  test("the alert is sent straight away when it can't be held", async () => {
    const account = await createAccount();
    const device = await prisma.userDevice.create({
      data: {
        activatedAt: new Date(),
        icon: "phone",
        id: `${account.userId}-held`,
        name: "Phone",
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        userId: account.userId,
      },
    });
    const caller = appRouter.createCaller(
      withDeviceActive({
        cache,
        db: prisma,
        emailCodes: null,
        securityAlerts: createAlerts({
          alertsTurnedOff: {
            ...cache.alertsTurnedOff,
            add: async () => {
              throw new Error("Redis is down");
            },
          },
        }),
        deviceId: device.id,
        session: {
          user: { id: account.userId },
          session: { id: "held", createdAt: new Date() },
        },
      }) as Parameters<typeof appRouter.createCaller>[0],
    );

    await caller.emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });

    expect((await sentAlerts()).map(({ alert }) => alert)).toEqual([
      { type: "alerts-turned-off", alerts: [newSignInEmail] },
    ]);
    expect(
      await prisma.accountNotice.findMany({
        where: { userId: account.userId },
        select: { type: true, excludeDeviceId: true, turnedOffEmail: true },
      }),
    ).toEqual([
      { type: "ALERTS_TURNED_OFF", excludeDeviceId: device.id, turnedOffEmail: ["NEW_SIGN_IN"] },
    ]);
  });

  test("turning alerts on or saving unchanged settings sends nothing", async () => {
    const account = await createAccount();
    await turnOffOptionalAlerts(account.userId);

    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: true,
      alertDeletionScheduled: false,
    });
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: true,
      alertDeletionScheduled: false,
    });
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: true,
      alertDeletionScheduled: true,
    });

    expect(await waitSeconds(60)).toEqual([]);
  });

  test("deleting an account immediately sends one alert to its address, even with optional alerts off", async () => {
    const account = await createAccount();
    await turnOffOptionalAlerts(account.userId);

    await (await account.activeCaller()).account.requestDeletion({ password, immediate: true });

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
    await (await account.activeCaller()).account.requestDeletion({ password });
    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual(["deletion-scheduled"]);
    sent.length = 0;
    await prisma.$executeRaw`UPDATE "User" SET "deletionDate" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${account.userId}`;

    await deleteAccountRecords({
      db: prisma,
      userId: account.userId,
      imageUrlPrefix: "https://cdn.example/bucket",
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
    await (await account.activeCaller()).account.requestDeletion({ password });
    resolve();

    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual([
      "new-sign-in",
      "deletion-scheduled",
    ]);
  });

  test("a failed send doesn't fail the request", async () => {
    const account = await createAccount();
    await registerDevice(account);
    sendFailure = new Error("SMTP is down");

    await changePhrase(account);
    const device = await registerDevice(account);
    await (await account.activeCaller()).account.requestDeletion({ password });

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

    expect(await (await account.activeCaller()).emailAlerts.settings()).toEqual({
      alertNewSignIn: true,
      alertDeletionScheduled: true,
    });
    await (
      await account.activeCaller()
    ).emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });
    expect(await (await account.activeCaller()).emailAlerts.settings()).toEqual({
      alertNewSignIn: false,
      alertDeletionScheduled: true,
    });
  });

  test("an unknown timezone is rejected", async () => {
    const account = await createAccount();

    await expect(
      (await account.activeCaller()).emailAlerts.setTimezone({ timezone: "Mars/Olympus" }),
    ).rejects.toThrow("Unknown timezone.");
    expect(
      await prisma.user.findUniqueOrThrow({
        select: { timezone: true },
        where: { id: account.userId },
      }),
    ).toEqual({ timezone: null });
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("notification settings", () => {
  const switchable: SecurityAlert[] = [
    { type: "new-sign-in", device: { model: null, platform: "android" } },
    { type: "password-changed" },
    { type: "password-reset" },
    { type: "recovery-phrase-changed" },
    { type: "recovery-phrase-reset" },
    { type: "other-sessions-signed-out", device: null },
    { type: "device-removed", device: { name: "Phone", model: null, platform: null } },
    { type: "deletion-scheduled", deletionDate: new Date("2026-12-01T00:00:00Z") },
  ];
  const securityTypes = [
    "NEW_SIGN_IN",
    "PASSWORD_CHANGED",
    "RECOVERY_PHRASE_CHANGED",
    "OTHER_SESSIONS_SIGNED_OUT",
    "DEVICE_REMOVED",
    "DELETION_SCHEDULED",
  ] as const;

  test("everything starts on except role changes, and only security types have email", async () => {
    const account = await createAccount();

    expect(await (await account.activeCaller()).notificationSettings.get()).toEqual({
      canSendEmail: authCapabilities.email,
      settings: [
        { type: "PLACE_ALERTS", email: null, phone: true },
        { type: "MEMBER_JOINED", email: null, phone: true },
        { type: "MEMBER_LEFT", email: null, phone: true },
        { type: "ROLE_CHANGED", email: null, phone: false },
        ...securityTypes
          .filter((type) => type !== "DELETION_SCHEDULED")
          .map((type) => ({ type, email: true, phone: true })),
        { type: "CRASH_ALERTS", email: null, phone: true },
        { type: "DRIVES", email: null, phone: true },
        { type: "DELETION_SCHEDULED", email: true, phone: true },
      ],
    });
    expect(await prisma.notificationSetting.count({ where: { userId: account.userId } })).toBe(0);
  });

  test("a change stores one row for that type and leaves its other channel and other accounts alone", async () => {
    const account = await createAccount();
    const other = await createAccount();

    const { settings } = await (
      await account.activeCaller()
    ).notificationSettings.set({
      type: "DEVICE_REMOVED",
      channel: "phone",
      enabled: false,
    });

    expect(settings.find(({ type }) => type === "DEVICE_REMOVED")).toEqual({
      type: "DEVICE_REMOVED",
      email: true,
      phone: false,
    });
    expect(
      await prisma.notificationSetting.findMany({
        where: { userId: { in: [account.userId, other.userId] } },
        select: { userId: true, type: true, email: true, phone: true },
      }),
    ).toEqual([{ userId: account.userId, type: "DEVICE_REMOVED", email: true, phone: false }]);
    expect(
      (await (await other.activeCaller()).notificationSettings.get()).settings.find(
        ({ type }) => type === "DEVICE_REMOVED",
      ),
    ).toEqual({ type: "DEVICE_REMOVED", email: true, phone: true });
  });

  test("place and group types have no email switch", async () => {
    const account = await createAccount();

    for (const type of ["PLACE_ALERTS", "MEMBER_JOINED", "MEMBER_LEFT", "ROLE_CHANGED"] as const) {
      await expect(
        (await account.activeCaller()).notificationSettings.set({
          type,
          channel: "email",
          enabled: false,
        }),
      ).rejects.toThrow("This message type has no email.");
    }
    expect(await prisma.notificationSetting.count({ where: { userId: account.userId } })).toBe(0);
  });

  test("every security email can be switched off, and switching off phone alone leaves the email on", async () => {
    const account = await createAccount();
    for (const type of securityTypes) {
      await (
        await account.activeCaller()
      ).notificationSettings.set({
        type,
        channel: "phone",
        enabled: false,
      });
    }
    await waitSeconds(60);
    sent.length = 0;

    for (const alert of switchable) securityAlerts.send(account.userId, alert);
    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual(
      switchable.map(({ type }) => type),
    );
    sent.length = 0;

    for (const type of securityTypes) {
      await (
        await account.activeCaller()
      ).notificationSettings.set({
        type,
        channel: "email",
        enabled: false,
      });
    }
    await waitSeconds(60);
    sent.length = 0;

    for (const alert of switchable) securityAlerts.send(account.userId, alert);
    securityAlerts.send(account.userId, { type: "account-deleted" });
    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual(["account-deleted"]);
  });

  test("switching security notifications off, by email or phone, sends one alert naming each switch", async () => {
    const account = await createAccount();
    const caller = await account.activeCaller();

    for (const { type, email } of (await caller.notificationSettings.get()).settings) {
      await caller.notificationSettings.set({ type, channel: "phone", enabled: false });
      if (email !== null)
        await caller.notificationSettings.set({ type, channel: "email", enabled: false });
    }

    expect((await waitSeconds(60)).map(({ alert }) => alert)).toEqual([
      {
        type: "alerts-turned-off",
        alerts: [
          ...securityTypes.flatMap((type) => [
            { type, channel: "phone" },
            { type, channel: "email" },
          ]),
        ],
      },
    ]);
  });

  const turnedOffNotices = (userId: string) =>
    prisma.accountNotice.findMany({
      where: { userId, type: "ALERTS_TURNED_OFF" },
      select: { excludeDeviceId: true, turnedOffEmail: true, turnedOffPhone: true },
    });

  test("switching every security notification off still writes one phone notice for the batch, skipping the device that did it", async () => {
    const account = await createAccount();
    const caller = await account.activeCaller();
    const device = await prisma.userDevice.findFirstOrThrow({ where: { userId: account.userId } });

    for (const type of securityTypes) {
      await caller.notificationSettings.set({ type, channel: "phone", enabled: false });
      await caller.notificationSettings.set({ type, channel: "email", enabled: false });
    }
    await waitSeconds(59);
    expect(await turnedOffNotices(account.userId)).toEqual([]);
    await waitSeconds(1);

    expect(await turnedOffNotices(account.userId)).toEqual([
      {
        excludeDeviceId: device.id,
        turnedOffEmail: [...securityTypes],
        turnedOffPhone: [...securityTypes],
      },
    ]);
  });

  test("a batch with changes from two devices skips no device", async () => {
    const account = await createAccount();
    await (
      await account.activeCaller()
    ).notificationSettings.set({ type: "NEW_SIGN_IN", channel: "phone", enabled: false });
    await waitSeconds(10);
    await (
      await account.activeCaller()
    ).notificationSettings.set({ type: "DEVICE_REMOVED", channel: "email", enabled: false });
    await waitSeconds(50);

    expect(await turnedOffNotices(account.userId)).toEqual([
      {
        excludeDeviceId: null,
        turnedOffEmail: ["DEVICE_REMOVED"],
        turnedOffPhone: ["NEW_SIGN_IN"],
      },
    ]);
  });

  test("a server without email still batches the notice and pushes it", async () => {
    const account = await createAccount();
    const pushed: string[] = [];
    const alerts = createAlerts({
      withEmail: false,
      push: { accountNotice: (noticeId) => pushed.push(noticeId) },
    });

    alerts.turnedOff(account.userId, [{ type: "NEW_SIGN_IN", channel: "phone" }], "phone-1");
    await waitSeconds(30);
    alerts.turnedOff(account.userId, [{ type: "PASSWORD_CHANGED", channel: "phone" }], "phone-1");
    await waitSeconds(29);
    expect(await turnedOffNotices(account.userId)).toEqual([]);
    await waitSeconds(1);

    const notices = await prisma.accountNotice.findMany({ where: { userId: account.userId } });
    expect(
      notices.map(({ excludeDeviceId, turnedOffPhone }) => ({ excludeDeviceId, turnedOffPhone })),
    ).toEqual([
      { excludeDeviceId: "phone-1", turnedOffPhone: ["NEW_SIGN_IN", "PASSWORD_CHANGED"] },
    ]);
    expect(pushed).toEqual(notices.map(({ id }) => id));
    expect(sent).toEqual([]);
  });

  test("switching place or group notifications off sends nothing", async () => {
    const account = await createAccount();
    const caller = await account.activeCaller();

    for (const type of ["PLACE_ALERTS", "MEMBER_JOINED", "MEMBER_LEFT"] as const) {
      await caller.notificationSettings.set({ type, channel: "phone", enabled: false });
    }

    expect(await waitSeconds(60)).toEqual([]);
  });

  test("switching something on, or to the value it already has, sends nothing", async () => {
    const account = await createAccount();
    const caller = await account.activeCaller();

    await caller.notificationSettings.set({
      type: "ROLE_CHANGED",
      channel: "phone",
      enabled: false,
    });
    await caller.notificationSettings.set({
      type: "ROLE_CHANGED",
      channel: "phone",
      enabled: true,
    });
    await caller.notificationSettings.set({ type: "NEW_SIGN_IN", channel: "email", enabled: true });

    expect(await waitSeconds(60)).toEqual([]);
  });

  test("the older email alerts endpoints read and write the same settings", async () => {
    const account = await createAccount();
    const caller = await account.activeCaller();

    await caller.notificationSettings.set({
      type: "DELETION_SCHEDULED",
      channel: "email",
      enabled: false,
    });
    expect(await caller.emailAlerts.settings()).toEqual({
      alertNewSignIn: true,
      alertDeletionScheduled: false,
    });
    await caller.emailAlerts.updateSettings({
      alertNewSignIn: false,
      alertDeletionScheduled: false,
    });
    expect(
      (await caller.notificationSettings.get()).settings.find(({ type }) => type === "NEW_SIGN_IN"),
    ).toEqual({ type: "NEW_SIGN_IN", email: false, phone: true });
  });
});
