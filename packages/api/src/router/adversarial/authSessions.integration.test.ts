import { afterAll, describe, expect, test } from "bun:test";
import { auth } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { deviceIdHeader } from "@openbeacon/shared";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { appRouter } from "../../root.ts";
import { createTRPCContext } from "../../trpc.ts";

const prefix = `adv-auth-sessions-${crypto.randomUUID()}`;
const password = "testing-password-123";
let clockMs = Date.now();
const cache = createIntegrationTestCache(() => clockMs);

let counter = 0;
const createAccount = async () => {
  counter += 1;
  const email = `${prefix}-${counter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Session Test" } });
  const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  const deviceId = `${prefix}-${counter}-phone`;
  await prisma.userDevice.create({
    data: {
      activatedAt: new Date(),
      icon: "phone",
      id: deviceId,
      name: "Phone",
      publicKey: "public-key",
      publicKeyAlgorithm: "X25519",
      userId: user.id,
    },
  });
  await prisma.session.update({ where: { id: session.id }, data: { deviceId } });
  return { deviceId, email, sessionId: session.id, userId: user.id };
};

type Account = Awaited<ReturnType<typeof createAccount>>;

const callerFor = (account: Account) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: account.deviceId,
      emailCodes: null,
      securityAlerts: null,
      session: {
        user: { id: account.userId, email: account.email },
        session: { id: account.sessionId, createdAt: new Date() },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const signIn = async (email: string) => {
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const session = await prisma.session.findUniqueOrThrow({ where: { token: response.token } });
  return { cookie: headers.get("set-cookie")?.split(";")[0] ?? "", id: session.id };
};

const httpCallerFor = async (cookie: string, deviceId?: string) =>
  appRouter.createCaller(
    await createTRPCContext({
      cache,
      db: prisma,
      headers: new Headers({ cookie, ...(deviceId ? { [deviceIdHeader]: deviceId } : {}) }),
      serverVersion: "test",
      serverName: "test",
      selfHosted: false,
    }),
  );

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial auth and sessions with PostgreSQL",
  () => {
    afterAll(async () => {
      const users = await prisma.user.findMany({
        where: { email: { startsWith: prefix } },
        select: { id: true },
      });
      await prisma.accountDeletionCleanup.deleteMany({
        where: { userId: { in: users.map(({ id }) => id) } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await prisma.$disconnect();
    }, 30_000);

    test.skip("ADV-AU-1 (open bug): account.requestDeletion checks the password outside the account's 10-in-15-minutes password failure limit — after 10 wrong guesses the right password should be refused", async () => {
      const account = await createAccount();
      for (let guess = 0; guess < 10; guess++) {
        if (guess % 5 === 0) clockMs += 61_000;
        expect(
          await errorOf(callerFor(account).account.requestDeletion({ password: `wrong-${guess}` })),
        ).toMatchObject({ code: "UNAUTHORIZED", message: "Password is incorrect." });
      }
      clockMs += 61_000;

      expect(await errorOf(callerFor(account).account.requestDeletion({ password }))).toMatchObject(
        { code: "TOO_MANY_REQUESTS" },
      );
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.userId } })).pendingDeletion,
      ).toBe(false);
    }, 30_000);

    test("sessions ended by signOutOtherSessions or by removing their phone can't reach setup procedures", async () => {
      const account = await createAccount();
      const unlinked = await signIn(account.email);
      expect(await (await httpCallerFor(unlinked.cookie)).accountRecovery.escrows()).toEqual([]);

      await callerFor(account).account.signOutOtherSessions();

      expect(
        await errorOf((await httpCallerFor(unlinked.cookie)).accountRecovery.escrows()),
      ).toMatchObject({ code: "UNAUTHORIZED" });

      const second = await signIn(account.email);
      const secondPhone = `${account.deviceId}-second`;
      await prisma.userDevice.create({
        data: {
          activatedAt: new Date(),
          icon: "phone",
          id: secondPhone,
          name: "Second phone",
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
          userId: account.userId,
        },
      });
      await prisma.session.update({ where: { id: second.id }, data: { deviceId: secondPhone } });
      expect(
        await (await httpCallerFor(second.cookie, secondPhone)).auth.listMyDeviceKeys(),
      ).toHaveLength(2);

      await callerFor(account).account.removeDevice({ deviceId: secondPhone });

      for (const deviceId of [secondPhone, undefined]) {
        expect(
          await errorOf(
            httpCallerFor(second.cookie, deviceId).then((caller) => caller.auth.deviceKeyContext()),
          ),
        ).toMatchObject({ code: "UNAUTHORIZED" });
      }
      expect(await prisma.session.count({ where: { id: second.id } })).toBe(0);
    }, 30_000);
  },
);
