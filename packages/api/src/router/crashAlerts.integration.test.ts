import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { FcmSendResult, WakeKind } from "@openbeacon/auth/fcm.ts";
import { createPushSender } from "@openbeacon/auth/push.ts";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  type CrashAlertMessage,
  createDeviceKeyPair,
  generateGroupEpochKey,
  openCrashAlert,
  sealCrashAlert,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { crashAlertsRouter } from "./crashAlertsRouter.ts";
import { groupTrackingRouter } from "./group/groupTrackingRouter.ts";
import { notificationSettingsRouter } from "./notificationSettingsRouter.ts";

const prefix = `crash-${crypto.randomUUID()}`;
const driverId = `${prefix}-driver`;
const viewerId = `${prefix}-viewer`;
const quietId = `${prefix}-quiet`;
const lateId = `${prefix}-late`;
const outsiderId = `${prefix}-outsider`;
const users = [driverId, viewerId, quietId, lateId, outsiderId];
const devices = {
  driverPhone: { id: `${driverId}-phone`, userId: driverId },
  driverTablet: { id: `${driverId}-tablet`, userId: driverId },
  viewerPhone: { id: `${viewerId}-phone`, userId: viewerId },
  quietPhone: { id: `${quietId}-phone`, userId: quietId },
  latePhone: { id: `${lateId}-phone`, userId: lateId },
  outsiderPhone: { id: `${outsiderId}-phone`, userId: outsiderId },
};
const familyId = `${prefix}-family`;
const workId = `${prefix}-work`;
const groupIds = [familyId, workId];
const epochKeys = new Map(
  groupIds.flatMap((groupId) =>
    [1, 2].map((epoch) => [`${groupId}-epoch-${epoch}`, generateGroupEpochKey()]),
  ),
);
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  crashAlerts: crashAlertsRouter,
  groupTracking: groupTrackingRouter,
  notificationSettings: notificationSettingsRouter,
});

const timers: { ms: number; run: () => void }[] = [];
const tasks: Promise<unknown>[] = [];
const woken: string[] = [];
const fcm = {
  send: async (token: string, kind: WakeKind = "sync"): Promise<FcmSendResult> => {
    woken.push(`${token.slice(0, -"-token".length)}:${kind}`);
    return { outcome: "sent" };
  },
};
const push = createPushSender({
  db: prisma,
  fcm,
  setTimer: (run, ms) => timers.push({ ms, run }),
  runInBackground: (task) => tasks.push(task),
});
const settle = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
};
const runTimers = async () => {
  await settle();
  const due = timers.splice(0);
  for (const timer of due) timer.run();
  await settle();
  return due.map(({ ms }) => ms);
};

const caller = (device: { id: string; userId: string }) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      deviceId: device.id,
      push,
      securityAlerts: null,
      session: { user: { id: device.userId }, session: { id: `${device.id}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const randomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");

const crashMessage = (): CrashAlertMessage => {
  const id = randomId();
  return {
    type: "CRASH",
    messageId: id,
    alertId: id,
    crash: { time: Date.now() - 70_000, latitude: 51.65, longitude: -0.2, speedBefore: 18.78 },
    sharingUntil: Date.now() + 15 * 60_000,
    okAt: null,
    placeLabel: "Barnet Lane, EN5",
  };
};

const copy = (
  message: CrashAlertMessage,
  { groupId = familyId, epoch = 2, senderDeviceId = devices.driverPhone.id } = {},
) => {
  const epochId = `${groupId}-epoch-${epoch}`;
  const epochKey = epochKeys.get(epochId);
  if (!epochKey) throw new Error("Missing test epoch key.");
  return {
    ...sealCrashAlert({ epochId, epochKey, groupId, message, senderDeviceId }),
    epochId,
    groupId,
  };
};

const send = (copies: ReturnType<typeof copy>[], device = devices.driverPhone) =>
  caller(device).crashAlerts.send({ copies });

const catchUp = async (device: { id: string; userId: string }, cursor: string | null) => {
  const result = await caller(device).groupTracking.uploadBatch({
    groupId: familyId,
    points: [],
    crashAlertsCursor: cursor,
  });
  if (!result.crashAlerts) throw new Error("No crash alerts in the catch-up.");
  return result.crashAlerts;
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "crash alerts with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: Object.values(devices).map((device) => ({
          ...device,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          name: device.id.endsWith("tablet") ? "Sam's Tablet" : "Sam's Phone",
          icon: "phone" as const,
          activatedAt: new Date(),
        })),
      });
      await prisma.pushToken.createMany({
        data: Object.values(devices).map(({ id }) => ({ deviceId: id, token: `${id}-token` })),
      });
      await prisma.session.createMany({
        data: Object.values(devices).map(({ id, userId }) => ({
          id: `${id}-session`,
          token: `${id}-session-token`,
          userId,
          deviceId: id,
          expiresAt: new Date(Date.now() + 86_400_000),
        })),
      });
      for (const groupId of groupIds) {
        await prisma.group.create({
          data: {
            id: groupId,
            name: groupId,
            groupMembers: {
              create: [
                { userId: driverId, role: "OWNER", joinedEpochNumber: 1 },
                { userId: viewerId, role: "MEMBER", joinedEpochNumber: 1 },
                { userId: quietId, role: "MEMBER", joinedEpochNumber: 1 },
                ...(groupId === familyId
                  ? [
                      {
                        userId: lateId,
                        role: "MEMBER" as const,
                        joinedEpochNumber: 2,
                        createdAt: new Date(Date.now() + 3_600_000),
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        await prisma.groupEpoch.createMany({
          data: [1, 2].map((epochNumber) => ({
            id: `${groupId}-epoch-${epochNumber}`,
            groupId,
            epochNumber,
            createdByDeviceId: devices.driverPhone.id,
            senderPublicKey: createDeviceKeyPair().publicKey,
          })),
        });
      }
      await prisma.notificationSetting.create({
        data: { userId: quietId, type: "CRASH_ALERTS", email: false, phone: false },
      });
    });

    beforeEach(async () => {
      await prisma.crashAlert.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.user.updateMany({ where: { id: driverId }, data: { sharingPaused: false } });
      await runTimers();
      woken.splice(0);
    });

    afterAll(async () => {
      await prisma.crashAlert.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("each Group gets its own sealed copy, stored once, that only members can open", async () => {
      const message = crashMessage();
      const copies = [copy(message), copy(message, { groupId: workId })];

      const sent = await send(copies);
      expect(sent.accepted.sort((a, b) => a.groupId.localeCompare(b.groupId))).toEqual(
        [
          { groupId: familyId, messageId: message.messageId },
          { groupId: workId, messageId: message.messageId },
        ].sort((a, b) => a.groupId.localeCompare(b.groupId)),
      );
      expect((await send(copies)).duplicates).toHaveLength(2);

      const { alerts } = await caller(devices.viewerPhone).crashAlerts.group({ groupId: familyId });
      expect(alerts).toHaveLength(1);
      const [stored] = alerts;
      if (!stored) throw new Error("Crash alert not listed.");
      expect(stored).toMatchObject({
        messageId: message.messageId,
        senderUserId: driverId,
        senderDeviceId: devices.driverPhone.id,
        deviceName: "Sam's Phone",
      });
      const epochKey = epochKeys.get(stored.epochId);
      if (!epochKey) throw new Error("Missing epoch key.");
      expect(
        openCrashAlert({
          epochId: stored.epochId,
          epochKey,
          groupId: familyId,
          sealed: stored,
          senderDeviceId: stored.senderDeviceId,
        }),
      ).toEqual(message);
      await expect(
        caller(devices.outsiderPhone).crashAlerts.group({ groupId: familyId }),
      ).rejects.toThrow();
    });

    test("a paused phone, a group it isn't in, and an Epoch from before it joined send nothing", async () => {
      await prisma.user.update({ where: { id: driverId }, data: { sharingPaused: true } });
      const paused = await send([copy(crashMessage())]);
      expect(paused.accepted).toEqual([]);
      expect(paused.discarded).toHaveLength(1);
      await prisma.user.update({ where: { id: driverId }, data: { sharingPaused: false } });

      const stranger = await send([copy(crashMessage())], devices.outsiderPhone);
      expect(stranger.accepted).toEqual([]);

      const late = await send([copy(crashMessage(), { epoch: 1 })], devices.latePhone);
      expect(late.accepted).toEqual([]);
      expect(late.expired).toHaveLength(1);

      expect(await prisma.crashAlert.count({ where: { groupId: { in: groupIds } } })).toBe(0);
    });

    test("members are woken at once with an ordinary sync push, even right after another wake", async () => {
      push.requestLocation([devices.viewerPhone.id]);
      await runTimers();
      woken.splice(0);

      await send([copy(crashMessage()), copy(crashMessage(), { groupId: workId })]);

      expect(await runTimers()).toEqual([1_000]);
      expect(woken.sort()).toEqual([`${devices.viewerPhone.id}:sync`]);
    });

    test("a member who turned Crash alerts off isn't woken but still sees the alert, marked quiet", async () => {
      const quietCursor = (await catchUp(devices.quietPhone, null)).cursor;
      const viewerCursor = (await catchUp(devices.viewerPhone, null)).cursor;
      const message = crashMessage();
      await send([copy(message)]);
      await runTimers();

      expect(woken).not.toContain(`${devices.quietPhone.id}:sync`);
      const quiet = await catchUp(devices.quietPhone, quietCursor);
      expect(quiet.notify).toBe(false);
      expect(quiet.alerts.map(({ messageId }) => messageId)).toEqual([message.messageId]);
      const viewer = await catchUp(devices.viewerPhone, viewerCursor);
      expect(viewer.notify).toBe(true);
      expect(viewer.alerts.map(({ messageId }) => messageId)).toEqual([message.messageId]);
    });

    test("the receiver's Crash alerts switch is its own notification type, on by default", async () => {
      const settings = await caller(devices.viewerPhone).notificationSettings.get();
      expect(settings.settings.find(({ type }) => type === "CRASH_ALERTS")).toEqual({
        type: "CRASH_ALERTS",
        email: null,
        phone: true,
      });
      await caller(devices.viewerPhone).notificationSettings.set({
        type: "CRASH_ALERTS",
        channel: "phone",
        enabled: false,
      });
      await send([copy(crashMessage())]);
      await runTimers();
      expect(woken).toEqual([]);
      await caller(devices.viewerPhone).notificationSettings.set({
        type: "CRASH_ALERTS",
        channel: "phone",
        enabled: true,
      });
    });

    test("the catch-up hands over new alerts straight away, never the sender's own or one from before joining", async () => {
      const start = await catchUp(devices.viewerPhone, null);
      expect(start.alerts).toEqual([]);
      const lateStart = await catchUp(devices.latePhone, null);
      const message = crashMessage();
      await send([copy(message)]);

      expect(
        (await catchUp(devices.viewerPhone, start.cursor)).alerts.map(({ messageId }) => messageId),
      ).toEqual([message.messageId]);
      expect((await catchUp(devices.driverTablet, start.cursor)).alerts).toEqual([]);
      expect((await catchUp(devices.latePhone, lateStart.cursor)).alerts).toEqual([]);
    });
  },
);
