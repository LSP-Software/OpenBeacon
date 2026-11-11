import { afterAll, describe, expect, test } from "bun:test";
import { auth } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  type DevicePrivateKeyMaterial,
  encodeBase64,
  openSessionLinkChallenge,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  sealDeviceLinkHandover,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import { deviceIdHeader, deviceUnverifiedCause } from "@openbeacon/shared";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { DeviceRemovedError } from "../lib/deviceRemoved.ts";
import { DeviceUnverifiedError } from "../lib/deviceUnverified.ts";
import { linkRequestDevice } from "../lib/requestDevice.ts";
import { appRouter } from "../root.ts";
import { createTRPCContext } from "../trpc.ts";

const prefix = `session-link-${crypto.randomUUID()}`;
const password = "testing-password-123";
const cache = createIntegrationTestCache(() => 0);

const callerFor = async ({
  deviceId,
  sessionId,
  userId,
}: {
  deviceId: string | null;
  sessionId: string;
  userId: string;
}) => {
  const device = deviceId
    ? await linkRequestDevice({ db: prisma, deviceId, session: { id: sessionId, userId } })
    : { removed: false as const, deviceId: null, unverifiedDeviceId: null, deviceActive: false };
  if (device.removed) throw new DeviceRemovedError();
  return appRouter.createCaller({
    cache,
    db: prisma,
    emailCodes: null,
    securityAlerts: null,
    clientIp: `ip-${userId}`,
    deviceId: device.deviceId,
    unverifiedDeviceId: device.unverifiedDeviceId,
    deviceActive: device.deviceActive,
    session: { user: { id: userId }, session: { id: sessionId, createdAt: new Date() } },
  } as Parameters<typeof appRouter.createCaller>[0]);
};

let accountCounter = 0;
const createAccount = async () => {
  accountCounter += 1;
  const email = `${prefix}-${accountCounter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Link Test" } });
  const signIn = async () => {
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    const session = await prisma.session.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
      where: { userId: user.id },
    });
    return { cookie: headers.get("set-cookie") ?? "", id: session.id };
  };
  const ownerSession = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  const register = async (sessionId: string, name: string, keyPair = createDeviceKeyPair()) => {
    const caller = await callerFor({ deviceId: null, sessionId, userId: user.id });
    const device = await caller.auth.registerDeviceKey({
      algorithm: "X25519",
      deviceId: `${prefix}-${accountCounter}-${name}`,
      expectedUserId: user.id,
      publicKey: keyPair.publicKey,
    });
    return { ...keyPair, id: device.id, sessionLinked: device.sessionLinked };
  };
  const phone = await register(ownerSession.id, "phone");
  const historyKey = createHistoryKeyPair();
  await (
    await callerFor({ deviceId: phone.id, sessionId: ownerSession.id, userId: user.id })
  ).accountHistory.create({
    algorithm: historyKey.algorithm,
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
  });
  const group = await prisma.group.create({
    data: {
      name: "Family",
      groupMembers: { create: { userId: user.id, role: "OWNER", joinedEpochNumber: 1 } },
    },
  });
  return {
    group,
    historyKey,
    ownerSession: ownerSession.id,
    phone,
    register,
    signIn,
    userId: user.id,
  };
};

type Account = Awaited<ReturnType<typeof createAccount>>;

const sessionDevice = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).deviceId;

const answerFor = async ({
  account,
  deviceId,
  privateKey,
  sessionId,
}: {
  account: Account;
  deviceId: string;
  privateKey: DevicePrivateKeyMaterial;
  sessionId: string;
}) => {
  const caller = await callerFor({ deviceId, sessionId, userId: account.userId });
  const challenge = await caller.device.sessionChallenge({ deviceId });
  if (challenge.linked) throw new Error("The session was already linked.");
  return openSessionLinkChallenge({
    deviceId,
    devicePrivateKey: privateKey,
    sealed: challenge.sealed,
    userId: account.userId,
  });
};

const expectUnverified = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ code: "FORBIDDEN" });
  expect((error as { cause?: unknown }).cause).toBeInstanceOf(DeviceUnverifiedError);
};

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  const users = await prisma.user.findMany({
    select: { id: true },
    where: { email: { startsWith: prefix } },
  });
  await prisma.group.deleteMany({
    where: { groupMembers: { some: { userId: { in: users.map(({ id }) => id) } } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "linking a session to a phone",
  () => {
    test("a new phone is linked to the sign-in that registers it", async () => {
      const account = await createAccount();

      expect(account.phone.sessionLinked).toBe(true);
      expect(await sessionDevice(account.ownerSession)).toBe(account.phone.id);
    });

    test("registering an existing phone from a new sign-in leaves the sign-in unlinked", async () => {
      const account = await createAccount();
      const signIn = await account.signIn();

      const again = await account.register(signIn.id, "phone", account.phone);

      expect(again.sessionLinked).toBe(false);
      expect(await sessionDevice(signIn.id)).toBeNull();
    });

    test("a sign-in with only the password can't act as the owner's phone by naming it", async () => {
      const account = await createAccount();
      const pendingSignIn = await account.signIn();
      const pending = await account.register(pendingSignIn.id, "pending");
      const pendingApi = await callerFor({
        deviceId: pending.id,
        sessionId: pendingSignIn.id,
        userId: account.userId,
      });
      const { linkId } = await pendingApi.deviceLink.create();
      const intruder = await account.signIn();
      const spoofed = await callerFor({
        deviceId: account.phone.id,
        sessionId: intruder.id,
        userId: account.userId,
      });

      await expectUnverified(
        spoofed.deviceLink.approve({
          linkId,
          ...sealDeviceLinkHandover({
            approverPrivateKey: account.phone.privateKey,
            historyKeys: [{ privateKey: account.historyKey.privateKey, version: 1 }],
            linkId,
            newDeviceId: pending.id,
            newDevicePublicKey: pending.publicKey,
            psk: createDeviceLinkSecret(),
            userId: account.userId,
          }),
        }),
      );
      await expectUnverified(spoofed.deviceLink.get({ linkId }));
      await expectUnverified(spoofed.account.removeDevice({ deviceId: pending.id }));
      await expectUnverified(spoofed.device.activationChallenge());
      await expectUnverified(
        spoofed.groupTracking.uploadBatch({
          groupId: account.group.id,
          points: [
            {
              algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
              ciphertext: "ciphertext",
              clientPointId: `${prefix}-point`,
              epochId: "epoch-1",
              kind: TRACKING_POINT_KIND,
              nonce: Buffer.alloc(24, 1).toString("base64"),
              senderDeviceId: account.phone.id,
            },
          ],
        }),
      );
      await expectUnverified(
        spoofed.groupEpoch.getEpochKeyWraps({
          deviceId: account.phone.id,
          epochId: "epoch-1",
          groupId: account.group.id,
        }),
      );
      await expectUnverified(spoofed.account.removeThisDevice());

      await expectUnverified(spoofed.account.listDevices());
      expect(await sessionDevice(intruder.id)).toBeNull();
      const devices = await prisma.userDevice.findMany({
        select: { activatedAt: true, id: true, revokedAt: true },
        where: { id: { in: [account.phone.id, pending.id] } },
      });
      expect(devices.find(({ id }) => id === pending.id)?.activatedAt).toBeNull();
      expect(devices.every(({ revokedAt }) => revokedAt === null)).toBe(true);
    });

    test("tells the app to prove the phone over HTTP", async () => {
      const account = await createAccount();
      const intruder = await account.signIn();
      const req = new Request("http://localhost/api/trpc/device.activationChallenge", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          cookie: intruder.cookie,
          [deviceIdHeader]: account.phone.id,
        },
        method: "POST",
      });

      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: async () => ({
          ...(await createTRPCContext({
            cache,
            db: prisma,
            headers: req.headers,
            serverVersion: "test",
            serverName: "test",
            selfHosted: true,
          })),
          clientIp: "127.0.0.1",
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { json: { data: { code: "FORBIDDEN", cause: deviceUnverifiedCause } } },
      });
      expect(await sessionDevice(intruder.id)).toBeNull();
    });

    test("a database failure while reading the phone fails the request instead of treating it as no phone", async () => {
      const account = await createAccount();
      const signIn = await account.signIn();
      const req = new Request("http://localhost/api/trpc/device.activationChallenge", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          cookie: signIn.cookie,
          [deviceIdHeader]: account.phone.id,
        },
        method: "POST",
      });
      const brokenDb = new Proxy(prisma, {
        get: (target, property, receiver) =>
          property === "userDevice"
            ? {
                findUnique: async () => {
                  throw new Error("Connection to the database was lost");
                },
              }
            : Reflect.get(target, property, receiver),
      });

      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: async () => ({
          ...(await createTRPCContext({
            cache,
            db: brokenDb,
            headers: req.headers,
            serverVersion: "test",
            serverName: "test",
            selfHosted: true,
          })),
          clientIp: "127.0.0.1",
        }),
      });

      expect(response.status).toBe(500);
      const body = JSON.stringify(await response.json());
      expect(body).toContain('"code":"INTERNAL_SERVER_ERROR"');
      expect(body).toContain('"cause":null');
      expect(body).not.toContain("Connection to the database was lost");
    });

    test("the phone's key links the sign-in, which then passes the gates", async () => {
      const account = await createAccount();
      const signIn = await account.signIn();
      const caller = await callerFor({
        deviceId: account.phone.id,
        sessionId: signIn.id,
        userId: account.userId,
      });
      const answer = await answerFor({
        account,
        deviceId: account.phone.id,
        privateKey: account.phone.privateKey,
        sessionId: signIn.id,
      });

      expect(await caller.device.linkSession({ answer, deviceId: account.phone.id })).toEqual({
        linked: true,
      });

      expect(await sessionDevice(signIn.id)).toBe(account.phone.id);
      expect(await prisma.deviceChallenge.count({ where: { sessionId: signIn.id } })).toBe(0);
      const linked = await callerFor({
        deviceId: account.phone.id,
        sessionId: signIn.id,
        userId: account.userId,
      });
      expect(await linked.device.status()).toMatchObject({ activated: true, registered: true });
      expect(
        await linked.groupEpoch.getEpochKeyWraps({
          deviceId: account.phone.id,
          epochId: "epoch-1",
          groupId: account.group.id,
        }),
      ).toEqual({ deviceWrap: null, historyWraps: [] });
      expect(await linked.device.sessionChallenge({ deviceId: account.phone.id })).toEqual({
        linked: true,
      });
      expect(await linked.device.linkSession({ answer, deviceId: account.phone.id })).toEqual({
        linked: true,
      });
    });

    test("can't link without the phone's private key", async () => {
      const account = await createAccount();
      const intruder = await account.signIn();
      const pendingSignIn = await account.signIn();
      const pending = await account.register(pendingSignIn.id, "pending");
      const caller = await callerFor({
        deviceId: account.phone.id,
        sessionId: intruder.id,
        userId: account.userId,
      });
      const link = (answer: string) =>
        caller.device.linkSession({ answer, deviceId: account.phone.id });

      await caller.device.sessionChallenge({ deviceId: account.phone.id });
      await expect(link(encodeBase64(new Uint8Array(32)))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      const sealedToPhone = await caller.device.sessionChallenge({ deviceId: account.phone.id });
      if (sealedToPhone.linked) throw new Error("The session was already linked.");
      expect(() =>
        openSessionLinkChallenge({
          deviceId: account.phone.id,
          devicePrivateKey: pending.privateKey,
          sealed: sealedToPhone.sealed,
          userId: account.userId,
        }),
      ).toThrow();

      const pendingAnswer = await answerFor({
        account,
        deviceId: pending.id,
        privateKey: pending.privateKey,
        sessionId: intruder.id,
      });
      await expect(link(pendingAnswer)).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const expired = await answerFor({
        account,
        deviceId: account.phone.id,
        privateKey: account.phone.privateKey,
        sessionId: intruder.id,
      });
      await prisma.deviceChallenge.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
        where: { sessionId: intruder.id },
      });
      await expect(link(expired)).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const used = await answerFor({
        account,
        deviceId: account.phone.id,
        privateKey: account.phone.privateKey,
        sessionId: intruder.id,
      });
      await expect(link(encodeBase64(new Uint8Array(32)))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(link(used)).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(await sessionDevice(intruder.id)).toBeNull();
    });

    test("a linked sign-in can't ask to become another phone", async () => {
      const account = await createAccount();
      const pendingSignIn = await account.signIn();
      const pending = await account.register(pendingSignIn.id, "pending");
      const caller = await callerFor({
        deviceId: account.phone.id,
        sessionId: pendingSignIn.id,
        userId: account.userId,
      });

      await expect(
        caller.device.sessionChallenge({ deviceId: account.phone.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.device.linkSession({
          answer: encodeBase64(new Uint8Array(32)),
          deviceId: account.phone.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await sessionDevice(pendingSignIn.id)).toBe(pending.id);
    });

    test("can't ask for a challenge for another account's phone", async () => {
      const account = await createAccount();
      const other = await createAccount();
      const signIn = await account.signIn();
      const caller = await callerFor({
        deviceId: other.phone.id,
        sessionId: signIn.id,
        userId: account.userId,
      });

      await expect(
        caller.device.sessionChallenge({ deviceId: other.phone.id }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.device.activationChallenge()).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    test("an unlinked sign-in naming a removed phone is signed out", async () => {
      const account = await createAccount();
      const signIn = await account.signIn();
      await prisma.userDevice.update({
        data: { revokedAt: new Date() },
        where: { id: account.phone.id },
      });

      await expect(
        callerFor({ deviceId: account.phone.id, sessionId: signIn.id, userId: account.userId }),
      ).rejects.toBeInstanceOf(DeviceRemovedError);
      expect(await prisma.session.findUnique({ where: { id: signIn.id } })).toBeNull();
    });
  },
);
